# frozen_string_literal: true

module Iforevents
  # The app's own user id plus traits (context merged in, nested hashes flattened).
  IdentifyEvent = Struct.new(:custom_id, :traits, keyword_init: true) do
    def initialize(custom_id:, traits: {})
      super(custom_id: custom_id, traits: traits || {})
    end
  end

  # A tracked event ready for every integration. +type+ is "track" or "page_view".
  TrackEvent = Struct.new(:name, :type, :properties, :timestamp, keyword_init: true) do
    def initialize(name:, type: "track", properties: {}, timestamp: Time.now.utc)
      super(name: name, type: type.to_s.empty? ? "track" : type, properties: properties || {}, timestamp: timestamp)
    end
  end

  # A page (web) or screen (mobile) view.
  PageEvent = Struct.new(:name, :properties, :navigation_type, :to_route, :previous_route, :timestamp, keyword_init: true) do
    def initialize(name: "page_view", properties: {}, navigation_type: nil, to_route: nil, previous_route: nil, timestamp: Time.now.utc)
      super(name: name.to_s.empty? ? "page_view" : name, properties: properties || {}, navigation_type: navigation_type, to_route: to_route, previous_route: previous_route, timestamp: timestamp)
    end
  end

  # Outcome of one integration call; the facade never raises for these.
  IntegrationResult = Struct.new(:integration, :success, :error, :timestamp, keyword_init: true) do
    def success?
      success
    end
  end

  # Flattens nested hashes with "_": {a: {b: 1}} becomes {"a_b" => 1}. Keys become strings.
  def self.flatten(hash, prefix = nil)
    out = {}
    (hash || {}).each do |key, value|
      name = prefix ? "#{prefix}_#{key}" : key.to_s
      if value.is_a?(Hash)
        out.merge!(flatten(value, name))
      else
        out[name] = value
      end
    end
    out
  end
end
