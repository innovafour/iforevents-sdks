# frozen_string_literal: true

require "iforevents"
require "mixpanel-ruby"

module Iforevents
  module Integrations
    # Forwards calls to Mixpanel through mixpanel-ruby. Mirrors iforevents_mixpanel.
    # The distinct id is the last identified custom_id; anonymous events use +anonymous_id+.
    class Mixpanel < Iforevents::Integration
      def initialize(token: nil, tracker: nil, anonymous_id: "server", **hooks)
        super(name: "MixpanelIntegration", **hooks)
        raise ArgumentError, "MixpanelIntegration needs a token or a tracker" if token.nil? && tracker.nil?

        @tracker = tracker || ::Mixpanel::Tracker.new(token)
        @anonymous_id = anonymous_id
        @distinct_id = nil
      end

      def identify(event)
        super
        @distinct_id = event.custom_id
        @tracker.people.set(event.custom_id, scalarize(event.traits))
      end

      def track(event)
        super
        props = scalarize(event.properties)
        props["time"] = event.timestamp.to_i
        @tracker.track(who, event.name, props)
      end

      def page(event)
        super
        props = event.properties.merge("navigation_type" => event.navigation_type, "to_route" => event.to_route, "previous_route" => event.previous_route)
        track(TrackEvent.new(name: event.name, type: "page_view", properties: props, timestamp: event.timestamp))
      end

      def reset
        super
        @distinct_id = nil
      end

      private

      def who
        @distinct_id || @anonymous_id
      end

      def scalarize(hash)
        hash.reject { |_, v| v.nil? }
      end
    end
  end
end
