package iforevents

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
)

// Storage keeps the user uuid (and the queue when persisted) across runs.
type Storage interface {
	Get(key string) (string, bool)
	Set(key, value string) error
	Remove(key string) error
}

// MemoryStorage is the default: nothing survives the process.
type MemoryStorage struct {
	mu   sync.Mutex
	data map[string]string
}

func NewMemoryStorage() *MemoryStorage { return &MemoryStorage{data: map[string]string{}} }

func (m *MemoryStorage) Get(key string) (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	v, ok := m.data[key]
	return v, ok
}

func (m *MemoryStorage) Set(key, value string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.data[key] = value
	return nil
}

func (m *MemoryStorage) Remove(key string) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	delete(m.data, key)
	return nil
}

// FileStorage is a JSON file, for CLIs and daemons that want the queue to survive restarts.
type FileStorage struct {
	Path string
	mu   sync.Mutex
}

func NewFileStorage(path string) *FileStorage { return &FileStorage{Path: path} }

func (f *FileStorage) read() map[string]string {
	data := map[string]string{}
	raw, err := os.ReadFile(f.Path)
	if err != nil {
		return data
	}
	_ = json.Unmarshal(raw, &data)
	return data
}

func (f *FileStorage) write(data map[string]string) error {
	if err := os.MkdirAll(filepath.Dir(f.Path), 0o755); err != nil {
		return err
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return err
	}
	tmp := f.Path + ".tmp"
	if err := os.WriteFile(tmp, raw, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, f.Path)
}

func (f *FileStorage) Get(key string) (string, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	v, ok := f.read()[key]
	return v, ok
}

func (f *FileStorage) Set(key, value string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	data := f.read()
	data[key] = value
	return f.write(data)
}

func (f *FileStorage) Remove(key string) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	data := f.read()
	if _, ok := data[key]; !ok {
		return nil
	}
	delete(data, key)
	if len(data) == 0 {
		err := os.Remove(f.Path)
		if errors.Is(err, os.ErrNotExist) {
			return nil
		}
		return err
	}
	return f.write(data)
}
