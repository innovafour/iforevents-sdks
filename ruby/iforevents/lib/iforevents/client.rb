# frozen_string_literal: true

require "monitor"

module Iforevents
  # The facade: one +init+, then +identify+ / +track+ / +page+ / +reset+ /
  # +flush+ / +shutdown+ fan out to every integration in isolation. Identify
  # traits are remembered and merged under later track properties; nested
  # hashes are flattened with "_". Mirrors the Flutter +Iforevents+ class.
  class Client
    attr_reader :integrations

    def initialize(integrations = [], context: nil, debug: false, on_result: nil)
      @integrations = Array(integrations)
      @context = context || -> { Context.default }
      @debug = debug
      @on_result = on_result
      @traits = {}
      @initialized = false
      @lock = Monitor.new
    end

    def initialized?
      @initialized
    end

    def current_traits
      @lock.synchronize { @traits.dup }
    end

    def add_integration(integration)
      @lock.synchronize { @integrations << integration }
      self
    end

    def integration(name)
      @integrations.find { |i| i.name == name || i.is_a?(name) rescue i.name == name }
    end

    def init(integrations = nil)
      @lock.synchronize { @integrations.concat(Array(integrations)) } if integrations
      results = fan_out(&:init)
      @initialized = true
      results
    end

    def identify(custom_id, traits = {})
      return [] if custom_id.to_s.empty? || !ready?("identify")

      merged = Iforevents.flatten(safe_context.merge(stringify(traits)))
      event = IdentifyEvent.new(custom_id: custom_id, traits: merged)
      results = fan_out { |i| i.identify(event) }
      @lock.synchronize { @traits = merged }
      results
    end

    def track(name, properties = {})
      return [] if name.to_s.empty? || !ready?("track")

      merged = @lock.synchronize { @traits.merge(stringify(properties)) }
      event = TrackEvent.new(name: name, properties: Iforevents.flatten(merged))
      fan_out { |i| i.track(event) }
    end

    def page(name = nil, properties = {}, navigation_type: nil, to_route: nil, previous_route: nil)
      return [] unless ready?("page")

      event = PageEvent.new(name: name || "page_view", properties: Iforevents.flatten(stringify(properties)), navigation_type: navigation_type, to_route: to_route, previous_route: previous_route)
      fan_out { |i| i.page(event) }
    end
    alias screen page

    def reset
      return [] unless ready?("reset")

      results = fan_out(&:reset)
      @lock.synchronize { @traits = {} }
      results
    end

    def flush
      fan_out(&:flush)
    end

    def shutdown
      results = fan_out(&:shutdown)
      @initialized = false
      results
    end

    private

    def stringify(hash)
      (hash || {}).each_with_object({}) { |(k, v), out| out[k.to_s] = v }
    end

    def ready?(method)
      return true if @initialized

      warn("[iforevents] #{method} called before init; ignored") if @debug
      false
    end

    def safe_context
      stringify(@context.call || {})
    rescue StandardError => e
      warn("[iforevents] context provider failed: #{e}") if @debug
      {}
    end

    def fan_out
      snapshot = @lock.synchronize { @integrations.dup }
      results = snapshot.map { |i| Iforevents.safe_execute(i) { yield i } }
      results.each { |r| warn("[iforevents] #{r.integration} failed: #{r.error}") if !r.success && @debug }
      @on_result&.call(results)
      results
    end
  end
end
