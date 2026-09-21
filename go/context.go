package iforevents

import (
	"os"
	"runtime"
)

const (
	SDKName    = "iforevents-go"
	SDKVersion = "0.1.0"
)

// DefaultContext is merged into identify traits, with the Flutter key names.
func DefaultContext() Properties {
	host, _ := os.Hostname()
	return Properties{
		"sdk_name":           SDKName,
		"sdk_version":        SDKVersion,
		"runtime":            "go/" + runtime.Version(),
		"device_platform":    "server",
		"device_brand":       runtime.GOOS,
		"device_model":       runtime.GOARCH,
		"device_os_version":  "",
		"device_app_version": "",
		"hostname":           host,
	}
}
