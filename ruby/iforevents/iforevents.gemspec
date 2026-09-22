# frozen_string_literal: true

require_relative "lib/iforevents/version"

Gem::Specification.new do |spec|
  spec.name = "iforevents"
  spec.version = Iforevents::VERSION
  spec.authors = ["Innovafour"]
  spec.summary = "IForevents analytics SDK for Ruby"
  spec.description = "One facade, pluggable integrations, a first-party API integration with batching, retries and typed errors, and the public project key as the only credential."
  spec.homepage = "https://iforevents.com/docs/sdks/ruby"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 2.7"
  spec.metadata = {
    "source_code_uri" => "https://github.com/innovafour/iforevents-ruby",
    "changelog_uri" => "https://github.com/innovafour/iforevents-ruby/blob/main/CHANGELOG.md",
    "rubygems_mfa_required" => "true",
  }
  spec.files = Dir["lib/**/*.rb", "README.md", "LICENSE"]
  spec.require_paths = ["lib"]
end
