//go:build linux || darwin

package jcmedia

import (
	"strconv"
	"syscall"
)

func hasDiskSpace(path string, required int64) bool {
	var st syscall.Statfs_t
	if syscall.Statfs(path, &st) != nil {
		return false
	}
	return uint64(st.Bavail)*uint64(st.Bsize) >= uint64(required)
}
func formatSeconds(n int64) string { return strconv.FormatInt(n, 10) }
