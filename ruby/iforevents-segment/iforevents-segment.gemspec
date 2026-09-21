# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name = "iforevents-segment"
  spec.version = "0.1.0"
  spec.authors = ["Innovafour"]
  spec.summary = "Segment adapter"
  spec.description = "Segment adapter for the IForevents analytics SDK: forwards identify, track, page and reset."
  spec.homepage = "https://iforevents.com/docs/sdks/ruby"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 2.7"
  spec.metadata = { "source_code_uri" => "https://github.com/innovafour/iforevents-ruby", "rubygems_mfa_required" => "true" }
  spec.files = Dir["lib/**/*.rb", "README.md"]
  spec.require_paths = ["lib"]
  spec.add_dependency "iforevents", "~> 0.1"
  spec.add_dependency "analytics-ruby", ">= 2.2"
end
