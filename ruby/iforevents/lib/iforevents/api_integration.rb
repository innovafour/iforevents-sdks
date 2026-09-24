# frozen_string_literal: true

require "json"
require "net/http"
require "securerandom"
require "uri"

module Iforevents
  # The first-party API integration: identify, batched track, page views, a
  # client-owned user id in X-User-Id, retries with Retry-After and typed
  # errors. Thread-safe. Mirrors IForeventsAPIIntegration of the Flutter package.
  #
  # Only +project_key+ is required. It is a public write key: it grants event
  # ingestion and nothing else. There is deliberately no project secret here.
  class APIIntegration < Integration
    USER_KEY = "iforevents_user_id"
    IDENTIFIED_KEY = "iforevents_user_identified"
    QUEUE_KEY = "iforevents_queue"
    MAX_BATCH = 500
    DEFAULT_BASE_URL = "https://api.iforevents.com"
    LIFTED_TRAITS = %w[email name phone_number].freeze

    attr_reader :project_key, :base_url, :batch_size, :flush_interval, :timeout, :max_retries, :retry_delay, :storage

    def initialize(project_key:, base_url: DEFAULT_BASE_URL, batch_size: 20, flush_interval: 10.0, timeout: 10.0, max_retries: 3, retry_delay: 1.0,
                   requeue_failed_events: true, debug: false, throw_on_error: false, on_quota_exceeded: nil, on_error: nil, storage: nil,
                   persist_queue: false, max_queue_size: 1000, user_agent: nil, flush_at_exit: true, logger: nil, **hooks)
      raise ArgumentError, "the project secret never belongs in an SDK; pass the project key only" if hooks.key?(:project_secret)
      raise ArgumentError, "APIIntegration needs a project_key" if project_key.to_s.strip.empty?

      super(name: "IForeventsAPIIntegration", **hooks)
      @project_key = project_key
      @base_url = base_url.to_s.sub(%r{/+\z}, "")
      @batch_size = batch_size.to_i.clamp(1, MAX_BATCH)
      @flush_interval = flush_interval
      @timeout = timeout
      @max_retries = [max_retries.to_i, 0].max
      @retry_delay = retry_delay
      @requeue_failed_events = requeue_failed_events
      @debug = debug
      @throw_on_error = throw_on_error
      @on_quota_exceeded = on_quota_exceeded
      @on_error = on_error
      @storage = storage || MemoryStorage.new
      @persist_queue = persist_queue
      @max_queue_size = max_queue_size
      @user_agent = user_agent || "#{SDK_NAME}/#{VERSION} ruby/#{RUBY_VERSION} (#{RbConfig::CONFIG['host_os']}; #{RbConfig::CONFIG['host_cpu']})"
      @logger = logger
      @queue = []
      @lock = Monitor.new
      @send_lock = Mutex.new
      @timer = nil
      @user_id = nil
      @initialized = false
      @identified = false
      @quota_exceeded = false
      at_exit { shutdown rescue nil } if flush_at_exit
    end

    # --- state -----------------------------------------------------------------

    def initialized?
      @initialized
    end

    def identified?
      @identified
    end

    # The id every request carries in X-User-Id: a generated "anon_..." id kept per visitor, or the custom_id of the last identify.
    def user_id
      @user_id
    end

    def queued_events
      @lock.synchronize { @queue.size }
    end

    # True after a quota_exceeded answer until the next accepted request.
    def quota_exceeded?
      @quota_exceeded
    end

    # A fresh anonymous id, unrelated to anything the server derives: anon_<uuid4 without dashes>.
    def self.anonymous_id
      "anon_#{SecureRandom.uuid.delete('-')}"
    end

    # --- Integration ------------------------------------------------------------

    def init
      super
      @lock.synchronize do
        stored = @storage.get(USER_KEY)
        if stored && !stored.empty?
          @user_id = stored
          @identified = @storage.get(IDENTIFIED_KEY) == "true"
        else
          # A fresh visitor: attribute everything to an anonymous id we own, so the
          # api never has to fingerprint the address (which merges users behind a NAT).
          set_user(self.class.anonymous_id, identified: false)
        end
        if @persist_queue && (raw = @storage.get(QUEUE_KEY))
          events = begin
            JSON.parse(raw)
          rescue JSON::ParserError
            nil
          end
          if events.is_a?(Array) && !events.empty?
            @queue = (events + @queue).last(@max_queue_size)
            schedule
          else
            @storage.remove(QUEUE_KEY)
          end
        end
        @initialized = true
      end
      debug("api integration ready base_url=#{@base_url} batch_size=#{@batch_size}")
    end

    def identify(event)
      super
      properties = event.traits.dup
      body = { "custom_id" => event.custom_id }
      LIFTED_TRAITS.each do |key|
        value = properties.delete(key) || properties.delete(key.to_sym)
        body[key] = value if value.is_a?(String) && !value.empty?
      end
      body["properties"] = properties
      # Attribute from now on, even if the profile request itself fails: the
      # api creates the profile on the first event it sees for this id.
      set_user(event.custom_id, identified: true)
      begin
        request("/v1/events/identify", body)
      rescue APIError => e
        report(e)
        raise if @throw_on_error
      end
    end

    def track(event)
      super
      queued = { "name" => event.name, "type" => event.type, "properties" => event.properties, "created_at" => iso(event.timestamp) }
      if @batch_size <= 1
        begin
          request("/v1/events/track", { "event_name" => event.name, "event_type" => event.type, "properties" => event.properties })
        rescue APIError => e
          report(e)
          raise if @throw_on_error
        end
        return
      end
      full = @lock.synchronize do
        @queue << queued
        @queue.shift(@queue.size - @max_queue_size) if @queue.size > @max_queue_size
        persist
        (@queue.size >= @batch_size).tap { |f| schedule unless f }
      end
      flush if full
    end

    def page(event)
      super
      props = event.properties.dup
      props["navigation_type"] = event.navigation_type if event.navigation_type
      props["to_route"] = event.to_route if event.to_route
      props["previous_route"] = event.previous_route if event.previous_route
      track(TrackEvent.new(name: event.name, type: "page_view", properties: props, timestamp: event.timestamp))
    end

    def reset
      super
      flush
    ensure
      # Forget the person; the next events belong to a fresh anonymous id.
      set_user(self.class.anonymous_id, identified: false)
    end

    # Sends the whole queue now, 500 events per request. Blocks until done.
    def flush
      cancel_timer
      @send_lock.synchronize do
        loop do
          events = @lock.synchronize do
            return if @queue.empty?

            @queue.shift(MAX_BATCH)
          end
          begin
            request("/v1/events/batch", { "events" => events })
            @lock.synchronize { persist }
          rescue APIError => e
            @lock.synchronize do
              if e.retryable? && @requeue_failed_events
                # Transient: keep these events at the front for the next flush.
                @queue.unshift(*events)
                schedule
              elsif !e.retryable?
                # A refused key or an exhausted quota fails the same way forever: drop everything.
                @queue.clear
              end
              persist
            end
            report(e)
            raise if @throw_on_error

            return
          end
        end
      end
    end

    def shutdown
      flush
    ensure
      cancel_timer
    end

    private

    def schedule
      return if @timer&.alive? || @queue.empty?

      interval = @flush_interval
      @timer = Thread.new do
        sleep(interval)
        @lock.synchronize { @timer = nil }
        begin
          flush
        rescue StandardError => e
          debug("timer flush failed: #{e}")
        end
      end
      @timer.abort_on_exception = false
    end

    def cancel_timer
      @lock.synchronize do
        t = @timer
        @timer = nil
        t&.kill if t && t != Thread.current
      end
    end

    def persist
      return unless @persist_queue

      if @queue.empty?
        @storage.remove(QUEUE_KEY)
      else
        @storage.set(QUEUE_KEY, JSON.generate(@queue))
      end
    end

    def set_user(id, identified:)
      @lock.synchronize do
        @user_id = id
        @identified = identified
        @storage.set(USER_KEY, id)
        @storage.set(IDENTIFIED_KEY, identified ? "true" : "false")
      end
    end

    def report(error)
      debug("request failed: #{error.message}")
      @on_error&.call(error)
    end

    def note_outcome(error)
      if error.is_a?(QuotaExceededError)
        unless @quota_exceeded
          @quota_exceeded = true
          @on_quota_exceeded&.call(error)
        end
      elsif error.nil?
        @quota_exceeded = false
      end
    end

    def debug(message)
      return unless @debug

      (@logger || $stderr).respond_to?(:info) ? @logger.info("[iforevents] #{message}") : $stderr.puts("[iforevents] #{message}")
    end

    def iso(time)
      time.respond_to?(:utc) ? time.utc.strftime("%Y-%m-%dT%H:%M:%S.%3NZ") : time.to_s
    end

    # POSTs JSON with retries; returns the decoded body (or nil).
    def request(path, body)
      payload = JSON.generate(body)
      uid = @user_id
      attempt = 0
      loop do
        error = nil
        begin
          status, text, headers = once(path, payload, uid)
          data = parse_json(text)
          debug("POST #{path} -> #{status}")
          if status.between?(200, 299)
            note_outcome(nil)
            return data
          end
          error = Iforevents.classify_response(status, data, headers["retry-after"])
        rescue SystemCallError, IOError, Timeout::Error, OpenSSL::SSL::SSLError, SocketError, Net::ProtocolError => e
          error = APIError.new(e.message)
        end
        if !error.retryable? || attempt >= @max_retries
          note_outcome(error)
          raise error
        end
        delay = error.is_a?(RateLimitedError) && error.retry_after.to_f.positive? ? error.retry_after.to_f : @retry_delay * (attempt + 1)
        debug("retrying #{path} in #{delay}s (#{attempt + 1}/#{@max_retries})")
        sleep(delay)
        attempt += 1
      end
    end

    def once(path, payload, uid)
      uri = URI.parse(@base_url + path)
      http = Net::HTTP.new(uri.host, uri.port)
      http.use_ssl = uri.scheme == "https"
      http.open_timeout = @timeout
      http.read_timeout = @timeout
      http.write_timeout = @timeout if http.respond_to?(:write_timeout=)
      req = Net::HTTP::Post.new(uri.request_uri)
      req["Content-Type"] = "application/json"
      req["X-Project-Key"] = @project_key
      req["User-Agent"] = @user_agent
      req["X-User-Id"] = uid if uid && !uid.empty?
      req.body = payload
      res = http.request(req)
      [res.code.to_i, res.body.to_s, res.to_hash.transform_values(&:first)]
    end

    def parse_json(text)
      return nil if text.nil? || text.empty?

      JSON.parse(text)
    rescue JSON::ParserError
      nil
    end
  end
end
