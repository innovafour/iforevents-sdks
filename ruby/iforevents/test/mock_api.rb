# frozen_string_literal: true

require "json"
require "socket"

# Tiny ingest api double on TCPServer (stdlib only): records requests,
# answers like the real api, supports fault injection.
class MockApi
  Recorded = Struct.new(:path, :headers, :body) do
    def header(name)
      headers[name.downcase]
    end
  end

  # What a scenario returns to answer a request itself: [status, body_hash, headers_hash].
  attr_reader :requests, :base_url
  attr_accessor :scenario

  def initialize
    @requests = []
    @mutex = Mutex.new
    @server = TCPServer.new("127.0.0.1", 0)
    @base_url = "http://127.0.0.1:#{@server.addr[1]}"
    @thread = Thread.new { serve }
    @thread.abort_on_exception = true
  end

  def stop
    @server.close
    @thread.kill
  end

  def reset
    @mutex.synchronize { @requests.clear }
    @scenario = nil
  end

  def by_path(path)
    @mutex.synchronize { @requests.select { |r| r.path == path } }
  end

  private

  def serve
    loop do
      client = @server.accept
      Thread.new(client) { |c| handle(c) rescue nil }
    end
  rescue IOError, Errno::EBADF
    nil
  end

  def handle(sock)
    request_line = sock.gets
    return sock.close if request_line.nil?

    _method, target, = request_line.split
    headers = {}
    while (line = sock.gets) && line != "\r\n"
      name, value = line.split(":", 2)
      headers[name.strip.downcase] = value.to_s.strip
    end
    length = headers["content-length"].to_i
    raw = length.positive? ? sock.read(length) : ""
    body = raw.empty? ? {} : JSON.parse(raw)
    rec = Recorded.new(target.split("?").first, headers, body)
    @mutex.synchronize { @requests << rec }
    status, payload, extra = @scenario&.call(rec) || default_answer(rec)
    respond(sock, status, payload, extra || {})
  ensure
    sock.close
  end

  def default_answer(rec)
    return [401, { "error" => "invalid project key" }, {}] unless rec.header("x-project-key") == "pk_test"

    case rec.path
    when "/v1/events/identify" then [201, { "user" => { "uuid" => "11111111-1111-4111-8111-111111111111" } }, {}]
    when "/v1/events/track" then [201, { "status" => "ok", "user_uuid" => "22222222-2222-4222-8222-222222222222" }, {}]
    when "/v1/events/batch" then [202, { "status" => "queued", "user_uuid" => "33333333-3333-4333-8333-333333333333" }, {}]
    else [404, { "error" => "not found" }, {}]
    end
  end

  def respond(sock, status, payload, extra)
    body = JSON.generate(payload)
    sock.write("HTTP/1.1 #{status} X\r\nContent-Type: application/json\r\nContent-Length: #{body.bytesize}\r\nConnection: close\r\n")
    extra.each { |k, v| sock.write("#{k}: #{v}\r\n") }
    sock.write("\r\n#{body}")
  end
end
