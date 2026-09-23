# frozen_string_literal: true

# Conformance suite for sdks/CONTRACT.md section 8; each test names its item.
require "minitest/autorun"
require "iforevents"
require_relative "mock_api"

class ConformanceTest < Minitest::Test
  ANON = /\Aanon_[0-9a-f]{32}\z/.freeze

  API = MockApi.new
  Minitest.after_run { API.stop }

  def setup
    API.reset
    @active = []
  end

  def teardown
    @active.each { |i| i.shutdown rescue nil }
  end

  def make(**overrides)
    opts = { project_key: "pk_test", base_url: API.base_url, retry_delay: 0.01, flush_interval: 0.06, flush_at_exit: false }.merge(overrides)
    Iforevents::APIIntegration.new(**opts).tap { |i| @active << i }
  end

  def boot(extra = [], **overrides)
    integration = make(**overrides)
    client = Iforevents::Client.new([integration] + extra, context: -> { { "device_platform" => "test", "sdk_name" => "iforevents-ruby" } })
    client.init
    [client, integration]
  end

  def names(req)
    req.body["events"].map { |e| e["name"] }
  end

  def test_01_identify_lifts_fields_switches_user_id
    client, integration = boot
    client.identify("user_1", email: "ada@example.com", name: "Ada", phone_number: "+1", plan: "pro", nested: { a: 1 })
    req = API.by_path("/v1/events/identify").first
    assert_equal "pk_test", req.header("x-project-key")
    assert_equal "application/json", req.header("content-type")
    assert req.header("user-agent").start_with?("iforevents-ruby/")
    assert_equal "user_1", req.header("x-user-id")
    assert_equal({ "custom_id" => "user_1", "email" => "ada@example.com", "name" => "Ada", "phone_number" => "+1",
                   "properties" => { "device_platform" => "test", "sdk_name" => "iforevents-ruby", "plan" => "pro", "nested_a" => 1 } }, req.body)
    assert_equal "user_1", integration.user_id
    assert integration.identified?
  end

  def test_02_track_after_identify_carries_user_id_and_only_its_own_properties
    client, = boot(batch_size: 1)
    client.identify("user_1", plan: "pro")
    client.track("clicked", button: "buy")
    req = API.by_path("/v1/events/track").first
    assert_equal "user_1", req.header("x-user-id")
    assert_equal({ "event_name" => "clicked", "event_type" => "track", "properties" => { "button" => "buy" } }, req.body)
  end

  def test_03_batch_size_n_sends_on_nth
    client, = boot(batch_size: 3, flush_interval: 10)
    client.track("a")
    client.track("b")
    sleep 0.02
    assert_empty API.requests
    client.track("c")
    batches = API.by_path("/v1/events/batch")
    assert_equal 1, batches.size
    assert_equal %w[a b c], names(batches[0])
    batches[0].body["events"].each do |e|
      assert_equal "track", e["type"]
      assert e["created_at"].end_with?("Z")
    end
  end

  def test_04_flush_interval_sends_partial_queue
    client, = boot(batch_size: 50, flush_interval: 0.05)
    client.track("only")
    assert_empty API.requests
    sleep 0.25
    assert_equal 1, API.by_path("/v1/events/batch").size
  end

  def test_05_batch_size_1_posts_track
    client, = boot(batch_size: 1)
    client.track("solo", n: 1)
    req = API.by_path("/v1/events/track").first
    assert_equal "solo", req.body["event_name"]
    assert_equal "track", req.body["event_type"]
  end

  def test_06_page_view_type_and_navigation
    client, = boot(batch_size: 1)
    client.page("/pricing", { title: "Pricing" }, navigation_type: "push", previous_route: "/")
    req = API.by_path("/v1/events/track").first
    assert_equal({ "event_name" => "/pricing", "event_type" => "page_view", "properties" => { "title" => "Pricing", "navigation_type" => "push", "previous_route" => "/" } }, req.body)
  end

  def test_07_anonymous_id_generated_persisted_reused
    storage = Iforevents::MemoryStorage.new
    client, integration = boot(batch_size: 1, storage: storage)
    client.track("first")
    client.track("second")
    first, second = API.by_path("/v1/events/track")
    anon = first.header("x-user-id")
    assert_match ANON, anon
    assert_equal anon, second.header("x-user-id")
    assert_equal anon, integration.user_id
    refute integration.identified?
    assert_equal anon, storage.get("iforevents_user_id")
    assert_equal "false", storage.get("iforevents_user_identified")
    again = make(storage: storage)
    again.init
    assert_equal anon, again.user_id
    other = make
    other.init
    assert_match ANON, other.user_id
    refute_equal anon, other.user_id
  end

  def test_08_reset_flushes_then_fresh_anonymous_id
    storage = Iforevents::MemoryStorage.new
    client, integration = boot(batch_size: 10, flush_interval: 10, storage: storage)
    client.identify("user_1")
    client.track("before_logout")
    client.reset
    batches = API.by_path("/v1/events/batch")
    assert_equal 1, batches.size
    assert_equal "user_1", batches[0].header("x-user-id")
    assert_match ANON, integration.user_id
    refute integration.identified?
    assert_equal integration.user_id, storage.get("iforevents_user_id")
    assert_empty client.current_traits
    client.track("after_logout")
    client.flush
    second = API.by_path("/v1/events/batch")[1]
    assert_equal integration.user_id, second.header("x-user-id")
    refute_equal "user_1", second.header("x-user-id")
  end

  def test_09_500_then_200_retries_same_events_once
    failures = 0
    API.scenario = lambda do |req|
      if req.path == "/v1/events/batch" && failures < 1
        failures += 1
        [500, { "error" => "boom" }, {}]
      end
    end
    client, = boot(batch_size: 2, max_retries: 2)
    client.track("x")
    client.track("y")
    client.flush
    batches = API.by_path("/v1/events/batch")
    assert_equal 2, batches.size
    assert_equal %w[x y], names(batches[1])
  end

  def test_10_quota_exceeded_no_retry_drop_callback_once
    refuse = true
    API.scenario = lambda do |req|
      [429, { "error" => "quota_exceeded", "message" => "plan quota exhausted", "limit" => 5_000_000, "used" => 5_000_001, "org_uuid" => "org-1" }, {}] if req.path == "/v1/events/batch" && refuse
    end
    seen = []
    client, integration = boot(batch_size: 500, on_quota_exceeded: ->(e) { seen << e })
    client.track("a")
    client.flush
    client.track("b")
    client.flush
    assert_equal 2, API.by_path("/v1/events/batch").size
    assert_equal 1, seen.size
    assert_kind_of Iforevents::QuotaExceededError, seen[0]
    assert_equal [5_000_000, 5_000_001, "org-1"], [seen[0].limit, seen[0].used, seen[0].organization_uuid]
    assert integration.quota_exceeded?
    assert_equal 0, integration.queued_events
    refuse = false
    client.track("c")
    client.flush
    refute integration.quota_exceeded?
    assert_equal ["c"], names(API.by_path("/v1/events/batch").last)
  end

  def test_11_rate_limit_retry_after_honored
    limited = true
    API.scenario = lambda do |req|
      if req.path == "/v1/events/batch" && limited
        limited = false
        [429, { "error" => "ingest_rate_limit_exceeded", "retry_after_seconds" => 1 }, { "Retry-After" => "1" }]
      end
    end
    errors = []
    client, = boot(batch_size: 500, on_error: ->(e) { errors << e })
    client.track("r")
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    client.flush
    assert_operator Process.clock_gettime(Process::CLOCK_MONOTONIC) - started, :>=, 0.95
    assert_equal 2, API.by_path("/v1/events/batch").size
    assert_empty errors
  end

  def test_11b_rate_limit_error_typed_when_retries_exhausted
    API.scenario = ->(req) { [429, { "error" => "ingest_rate_limit_exceeded" }, { "Retry-After" => "0" }] if req.path == "/v1/events/identify" }
    errors = []
    client, = boot(max_retries: 1, on_error: ->(e) { errors << e })
    client.identify("u")
    assert_equal 2, API.by_path("/v1/events/identify").size
    assert_kind_of Iforevents::RateLimitedError, errors[0]
  end

  def test_12_401_no_retry_drop_auth_error
    errors = []
    integration = make(project_key: "pk_wrong", batch_size: 500, on_error: ->(e) { errors << e })
    client = Iforevents::Client.new([integration])
    client.init
    client.track("a")
    client.flush
    assert_equal 1, API.by_path("/v1/events/batch").size
    assert_equal 0, integration.queued_events
    assert_kind_of Iforevents::AuthError, errors[0]
    assert_equal 401, errors[0].status
  end

  def test_13_throwing_integration_does_not_stop_api
    broken = Class.new(Iforevents::Integration) do
      def initialize
        super(name: "Broken")
      end

      def track(event)
        super
        raise "vendor down"
      end
    end.new
    integration = make(batch_size: 1)
    client = Iforevents::Client.new([broken, integration])
    client.init
    results = client.track("still_delivered")
    assert_equal [["Broken", false], ["IForeventsAPIIntegration", true]], results.map { |r| [r.integration, r.success] }
    assert_equal 1, API.by_path("/v1/events/track").size
  end

  def test_14_no_secret_anywhere
    client, = boot(batch_size: 1)
    client.identify("u", plan: "pro")
    client.track("t")
    client.page("/p")
    API.requests.each do |r|
      refute_includes r.body.to_s.downcase, "secret"
      refute_includes r.headers.keys.join(",").downcase, "secret"
    end
    assert_raises(ArgumentError) { Iforevents::APIIntegration.new(project_key: "pk", project_secret: "nope") }
  end

  def test_15_flatten
    assert_equal({ "a_b_c" => 1, "list" => [1, { "d" => 2 }], "plain" => "x" }, Iforevents.flatten({ a: { b: { c: 1 } }, list: [1, { "d" => 2 }], plain: "x" }))
  end

  def test_queue_persists_across_restarts
    storage = Iforevents::MemoryStorage.new
    first = make(batch_size: 100, flush_interval: 10, storage: storage, persist_queue: true)
    first.init
    first.track(Iforevents::TrackEvent.new(name: "offline"))
    assert_includes storage.get("iforevents_queue"), "offline"
    second = make(batch_size: 100, flush_interval: 10, storage: storage, persist_queue: true)
    second.init
    assert_equal 1, second.queued_events
    second.flush
    assert_equal 1, API.by_path("/v1/events/batch").size
    assert_nil storage.get("iforevents_queue")
  end

  def test_calls_before_init_ignored
    client = Iforevents::Client.new([make])
    assert_empty client.track("early")
    assert_empty client.identify("u")
    assert_empty API.requests
  end

  def test_identify_attributes_even_when_profile_request_fails
    API.scenario = ->(req) { [500, { "error" => "down" }, {}] if req.path == "/v1/events/identify" }
    client, integration = boot(batch_size: 1, max_retries: 0)
    client.identify("user_x")
    assert_equal "user_x", integration.user_id
    client.track("still_attributed")
    assert_equal "user_x", API.by_path("/v1/events/track")[0].header("x-user-id")
  end

  def test_throw_on_error_raises_and_recovers
    API.scenario = ->(_req) { [500, { "error" => "down" }, {}] }
    client, integration = boot(max_retries: 0, throw_on_error: true, batch_size: 500)
    result = client.identify("u").first
    refute result.success
    assert_includes result.error.message, "down"
    client.track("x")
    assert_raises(Iforevents::APIError) { integration.flush }
    API.scenario = nil
    integration.flush
    assert_equal 1, names(API.by_path("/v1/events/batch").last).size
  end

  def test_thread_safety_many_tracks_all_delivered
    client, integration = boot(batch_size: 7, flush_interval: 10)
    threads = 8.times.map { |i| Thread.new { 20.times { |n| client.track("t#{i}_#{n}") } } }
    threads.each(&:join)
    client.flush
    delivered = API.by_path("/v1/events/batch").sum { |b| b.body["events"].size }
    assert_equal 160, delivered
    assert_equal 0, integration.queued_events
  end
end
