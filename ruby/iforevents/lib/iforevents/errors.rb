# frozen_string_literal: true

module Iforevents
  # A request failed after retries. Every api failure body is
  # {"error": <code or message>, "message"?: ...}. AuthError and
  # QuotaExceededError are permanent: their events are dropped, not re-queued.
  class APIError < StandardError
    attr_reader :status, :code, :details

    def initialize(message, status: nil, code: nil, details: nil)
      super(message)
      @status = status
      @code = code
      @details = details
    end

    def retryable?
      status.nil? || status >= 500
    end
  end

  # Project key unknown, rotated or project disabled (401/403).
  class AuthError < APIError
    def retryable?
      false
    end
  end

  # Monthly plan quota exhausted (429 quota_exceeded).
  class QuotaExceededError < APIError
    attr_reader :limit, :used, :organization_uuid

    def initialize(message, details: nil, limit: nil, used: nil, organization_uuid: nil)
      super(message, status: 429, code: "quota_exceeded", details: details)
      @limit = limit
      @used = used
      @organization_uuid = organization_uuid
    end

    def retryable?
      false
    end
  end

  # Too many requests in a short window (429 without a quota code); retried after +retry_after+ seconds.
  class RateLimitedError < APIError
    attr_reader :retry_after

    def initialize(message, code: nil, details: nil, retry_after: nil)
      super(message, status: 429, code: code, details: details)
      @retry_after = retry_after
    end

    def retryable?
      true
    end
  end

  # Builds the typed error for an HTTP answer.
  def self.classify_response(status, body, retry_after_header)
    details = body.is_a?(Hash) ? body : nil
    code = details && details["error"].is_a?(String) ? details["error"] : nil
    message = (details && details["message"]) || code || "request failed with status #{status}"
    if status == 429 && code == "quota_exceeded"
      QuotaExceededError.new(message, details: details, limit: to_i(details["limit"]), used: to_i(details["used"]), organization_uuid: details["org_uuid"])
    elsif status == 429
      seconds = retry_after_header.to_s.strip.empty? ? nil : retry_after_header.to_f
      seconds ||= to_i(details && details["retry_after_seconds"])
      RateLimitedError.new(message, code: code, details: details, retry_after: seconds)
    elsif [401, 403].include?(status)
      AuthError.new(message, status: status, code: code, details: details)
    else
      APIError.new(message, status: status, code: code, details: details)
    end
  end

  def self.to_i(value)
    case value
    when Integer then value
    when Float then value.to_i
    when String then value.to_i
    end
  end
end
