# frozen_string_literal: true

require "json"

module Iforevents
  # Nothing survives the process; the default on servers.
  class MemoryStorage
    def initialize
      @data = {}
      @mutex = Mutex.new
    end

    def get(key)
      @mutex.synchronize { @data[key] }
    end

    def set(key, value)
      @mutex.synchronize { @data[key] = value }
    end

    def remove(key)
      @mutex.synchronize { @data.delete(key) }
    end
  end

  # A JSON file, for CLIs and daemons that want the queue to survive restarts.
  class FileStorage
    def initialize(path)
      @path = path
      @mutex = Mutex.new
    end

    def get(key)
      @mutex.synchronize { read[key] }
    end

    def set(key, value)
      @mutex.synchronize do
        data = read
        data[key] = value
        write(data)
      end
    end

    def remove(key)
      @mutex.synchronize do
        data = read
        write(data) if data.delete(key)
      end
    end

    private

    def read
      return {} unless File.exist?(@path)

      JSON.parse(File.read(@path))
    rescue JSON::ParserError, SystemCallError
      {}
    end

    def write(data)
      dir = File.dirname(@path)
      Dir.mkdir(dir) unless Dir.exist?(dir)
      tmp = "#{@path}.tmp"
      File.write(tmp, JSON.generate(data))
      File.rename(tmp, @path)
    end
  end
end
