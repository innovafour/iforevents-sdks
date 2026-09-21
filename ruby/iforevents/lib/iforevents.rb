# frozen_string_literal: true

require "monitor"
require_relative "iforevents/version"
require_relative "iforevents/events"
require_relative "iforevents/integration"
require_relative "iforevents/errors"
require_relative "iforevents/storage"
require_relative "iforevents/context"
require_relative "iforevents/api_integration"
require_relative "iforevents/client"

# IForevents analytics SDK for Ruby.
module Iforevents
  # Convenience: +Iforevents.new(project_key: "pk_...", integrations: [...])+ builds and initializes a client.
  def self.new(project_key:, integrations: [], context: nil, debug: false, on_result: nil, **api_options)
    api = APIIntegration.new(project_key: project_key, debug: debug, **api_options)
    client = Client.new([api] + Array(integrations), context: context, debug: debug, on_result: on_result)
    client.init
    client
  end
end
