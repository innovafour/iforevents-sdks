# frozen_string_literal: true

require "iforevents"
require "segment/analytics"

module Iforevents
  module Integrations
    # Forwards calls to Segment through analytics-ruby. Mirrors iforevents_segment.
    class Segment < Iforevents::Integration
      def initialize(write_key: nil, client: nil, anonymous_id: "server", client_options: {}, **hooks)
        super(name: "SegmentIntegration", **hooks)
        raise ArgumentError, "SegmentIntegration needs a write_key or a client" if write_key.nil? && client.nil?

        @client = client || ::Segment::Analytics.new({ write_key: write_key }.merge(client_options))
        @anonymous_id = anonymous_id
        @user_id = nil
      end

      def identify(event)
        super
        @user_id = event.custom_id
        @client.identify(user_id: event.custom_id, traits: event.traits)
      end

      def track(event)
        super
        @client.track(who.merge(event: event.name, properties: event.properties, timestamp: event.timestamp))
      end

      def page(event)
        super
        props = event.properties.merge("navigation_type" => event.navigation_type, "to_route" => event.to_route, "previous_route" => event.previous_route).compact
        @client.page(who.merge(name: event.name, properties: props, timestamp: event.timestamp))
      end

      def reset
        super
        @user_id = nil
      end

      def flush
        @client.flush
      end

      def shutdown
        @client.flush
      end

      private

      def who
        @user_id ? { user_id: @user_id } : { anonymous_id: @anonymous_id }
      end
    end
  end
end
