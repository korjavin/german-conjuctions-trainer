package app

import (
	"log"
	"os"
	"path/filepath"
	"sort"
)

type FileInfo struct {
	Path    string
	Size    int64
	ModTime int64
}

func (a *App) cleanupAudioCache() {
	cacheDir := "audio_cache"
	maxSizeBytes := a.ElevenLabs.AudioCacheMaxSizeMB * 1024 * 1024
	targetSizeBytes := int64(float64(maxSizeBytes) * 0.9)

	var files []FileInfo
	var totalSize int64

	err := filepath.Walk(cacheDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			files = append(files, FileInfo{
				Path:    path,
				Size:    info.Size(),
				ModTime: info.ModTime().UnixNano(),
			})
			totalSize += info.Size()
		}
		return nil
	})

	if err != nil {
		log.Printf("Error walking audio_cache directory: %v", err)
		return
	}

	if totalSize <= maxSizeBytes {
		return
	}

	log.Printf("Audio cache size (%d bytes) exceeds limit (%d bytes). Starting cleanup.", totalSize, maxSizeBytes)

	// Sort files by modification time, oldest first
	sort.Slice(files, func(i, j int) bool {
		return files[i].ModTime < files[j].ModTime
	})

	deletedCount := 0
	deletedSize := int64(0)

	for _, file := range files {
		if totalSize <= targetSizeBytes {
			break
		}

		err := os.Remove(file.Path)
		if err != nil {
			log.Printf("Failed to delete %s during cleanup: %v", file.Path, err)
			continue
		}

		totalSize -= file.Size
		deletedSize += file.Size
		deletedCount++
	}

	log.Printf("Audio cache cleanup complete. Deleted %d files (%d bytes). Current size: %d bytes.", deletedCount, deletedSize, totalSize)
}
