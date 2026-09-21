# frozen_string_literal: true

module Iforevents
  # Base class every integration extends; mirrors the Flutter +Integration+.
  # Override what the vendor supports and call +super+ first so hooks run.
  class Integration
    attr_reader :name

    def initialize(name: nil, on_init: nil, on_identify: nil, on_track: nil, on_page: nil, on_reset: nil)
      @name = name || self.class.name.split("::").last
      @on_init = on_init
      @on_identify = on_identify
      @on_track = on_track
      @on_page = on_page
      @on_reset = on_reset
    end

    def init
      @on_init&.call
    end

    def identify(event)
      @on_identify&.call(event)
    end

    def track(event)
      @on_track&.call(event)
    end

    def page(event)
      @on_page&.call(event)
    end

    def reset
      @on_reset&.call
    end

    # Sends anything buffered. No-op by default.
    def flush; end

    # Flushes and releases resources. No-op by default.
    def shutdown; end
  end

  # Runs one integration call in isolation and reports the outcome.
  def self.safe_execute(integration)
    yield
    IntegrationResult.new(integration: integration.name, success: true, error: nil, timestamp: Time.now.utc)
  rescue StandardError => e
    IntegrationResult.new(integration: integration.name, success: false, error: e, timestamp: Time.now.utc)
  end
end
