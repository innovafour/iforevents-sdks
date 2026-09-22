# frozen_string_literal: true

require "socket"
require "rbconfig"

module Iforevents
  # Default context merged into identify traits, with the Flutter key names.
  module Context
    def self.default(extra = {})
      {
        "sdk_name" => SDK_NAME,
        "sdk_version" => VERSION,
        "runtime" => "ruby/#{RUBY_VERSION}",
        "device_platform" => "server",
        "device_brand" => RbConfig::CONFIG["host_os"].to_s,
        "device_model" => RbConfig::CONFIG["host_cpu"].to_s,
        "device_os_version" => "",
        "device_app_version" => "",
        "hostname" => (Socket.gethostname rescue ""),
      }.merge(extra || {})
    end
  end
end
