# frozen_string_literal: true

require "minitest/autorun"
require "iforevents-mixpanel"

class MixpanelIntegrationTest < Minitest::Test
  class FakeTracker
    attr_reader :calls, :people

    def initialize
      @calls = []
      @people = Object.new
      calls = @calls
      @people.define_singleton_method(:set) { |id, props, *_| calls << [:people_set, id, props] }
    end

    def track(distinct_id, event, properties = {}, _ip = nil)
      @calls << [:track, distinct_id, event, properties]
    end
  end

  def test_forwarding
    tracker = FakeTracker.new
    client = Iforevents::Client.new([Iforevents::Integrations::Mixpanel.new(tracker: tracker)], context: -> { {} })
    client.init
    client.track("anon")
    client.identify("u", plan: "pro", nested: { x: 1 }, nil_value: nil)
    client.track("paid", amount: 1)
    client.page("Home", navigation_type: "load")
    client.reset
    client.track("again")
    assert_equal [:track, "server", "anon"], tracker.calls[0][0..2]
    assert_equal [:people_set, "u", { "plan" => "pro", "nested_x" => 1 }], tracker.calls[1]
    assert_equal "u", tracker.calls[2][1]
    assert_equal 1, tracker.calls[2][3]["amount"]
    assert tracker.calls[2][3].key?("time")
    assert_equal "Home", tracker.calls[3][2]
    assert_equal "load", tracker.calls[3][3]["navigation_type"]
    assert_equal "server", tracker.calls[4][1]
  end

  def test_real_tracker_constructs
    integration = Iforevents::Integrations::Mixpanel.new(token: "t")
    integration.init
  end
end
