# frozen_string_literal: true

require "minitest/autorun"
require "iforevents-segment"

class SegmentIntegrationTest < Minitest::Test
  class FakeClient
    attr_reader :calls

    def initialize
      @calls = []
    end

    %i[identify track page].each { |m| define_method(m) { |attrs| @calls << [m, attrs] } }

    def flush
      @calls << [:flush]
    end
  end

  def test_forwarding
    fake = FakeClient.new
    client = Iforevents::Client.new([Iforevents::Integrations::Segment.new(client: fake)], context: -> { {} })
    client.init
    client.track("anon")
    client.identify("u", plan: "pro")
    client.track("paid", amount: 1)
    client.page("Home", to_route: "/")
    client.reset
    client.track("again")
    client.shutdown
    assert_equal [:track, { anonymous_id: "server", event: "anon", properties: {}, timestamp: fake.calls[0][1][:timestamp] }], fake.calls[0]
    assert_equal [:identify, { user_id: "u", traits: { "plan" => "pro" } }], fake.calls[1]
    assert_equal "u", fake.calls[2][1][:user_id]
    assert_equal({ "plan" => "pro", "amount" => 1 }, fake.calls[2][1][:properties])
    assert_equal [:page, "Home", "/"], [fake.calls[3][0], fake.calls[3][1][:name], fake.calls[3][1][:properties]["to_route"]]
    assert_equal "server", fake.calls[4][1][:anonymous_id]
    assert_equal [:flush], fake.calls.last
  end

  def test_real_client_constructs
    integration = Iforevents::Integrations::Segment.new(write_key: "wk", client_options: { stub: true })
    integration.init
  end
end
