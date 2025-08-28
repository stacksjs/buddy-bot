import { describe, expect, it } from 'bun:test'
import { isDockerfile, parseDockerfile, updateDockerfile } from '../src/utils/dockerfile-parser'

describe('Dockerfile Parser', () => {
  describe('isDockerfile', () => {
    it('should identify Dockerfile files correctly', () => {
      expect(isDockerfile('Dockerfile')).toBe(true)
      expect(isDockerfile('dockerfile')).toBe(true)
      expect(isDockerfile('Dockerfile.dev')).toBe(true)
      expect(isDockerfile('Dockerfile.prod')).toBe(true)
      expect(isDockerfile('Dockerfile.production')).toBe(true)
      expect(isDockerfile('some/path/Dockerfile')).toBe(true)
      expect(isDockerfile('package.json')).toBe(false)
      expect(isDockerfile('docker-compose.yml')).toBe(false)
    })
  })

  describe('parseDockerfile', () => {
    it('should parse FROM instructions with versions', async () => {
      const dockerfileContent = `
FROM node:18.17.0
FROM alpine:3.18
FROM ubuntu:22.04 as builder
FROM scratch
FROM registry.example.com/myimage:v1.2.3
`

      const result = await parseDockerfile('Dockerfile', dockerfileContent)

      expect(result).not.toBeNull()
      expect(result?.dependencies).toHaveLength(4) // scratch should be skipped

      const deps = result?.dependencies || []
      expect(deps[0]).toEqual({
        name: 'node',
        currentVersion: '18.17.0',
        type: 'docker-image',
        file: 'Dockerfile',
      })

      expect(deps[1]).toEqual({
        name: 'alpine',
        currentVersion: '3.18',
        type: 'docker-image',
        file: 'Dockerfile',
      })

      expect(deps[2]).toEqual({
        name: 'ubuntu',
        currentVersion: '22.04',
        type: 'docker-image',
        file: 'Dockerfile',
      })

      expect(deps[3]).toEqual({
        name: 'registry.example.com/myimage',
        currentVersion: 'v1.2.3',
        type: 'docker-image',
        file: 'Dockerfile',
      })
    })

    it('should handle images without explicit versions', async () => {
      const dockerfileContent = `
FROM node
FROM alpine
`

      const result = await parseDockerfile('Dockerfile', dockerfileContent)

      expect(result).not.toBeNull()
      expect(result?.dependencies).toHaveLength(2)

      const deps = result?.dependencies || []
      expect(deps[0]).toEqual({
        name: 'node',
        currentVersion: 'latest',
        type: 'docker-image',
        file: 'Dockerfile',
      })

      expect(deps[1]).toEqual({
        name: 'alpine',
        currentVersion: 'latest',
        type: 'docker-image',
        file: 'Dockerfile',
      })
    })

    it('should skip variable-based images', async () => {
      const dockerfileContent = `
FROM $BASE_IMAGE
FROM node:\${NODE_VERSION}
FROM alpine:3.18
`

      const result = await parseDockerfile('Dockerfile', dockerfileContent)

      expect(result).not.toBeNull()
      expect(result?.dependencies).toHaveLength(1) // Only alpine should be parsed

      const deps = result?.dependencies || []
      expect(deps[0]).toEqual({
        name: 'alpine',
        currentVersion: '3.18',
        type: 'docker-image',
        file: 'Dockerfile',
      })
    })
  })

  describe('updateDockerfile', () => {
    it('should update Docker image versions', async () => {
      const dockerfileContent = `
FROM node:18.17.0
FROM alpine:3.18
FROM ubuntu:22.04 as builder
`

      const updates = [
        {
          name: 'node',
          currentVersion: '18.17.0',
          newVersion: '18.19.0',
          updateType: 'minor' as const,
          dependencyType: 'docker-image' as const,
          file: 'Dockerfile',
        },
        {
          name: 'alpine',
          currentVersion: '3.18',
          newVersion: '3.19',
          updateType: 'minor' as const,
          dependencyType: 'docker-image' as const,
          file: 'Dockerfile',
        },
      ]

      const result = await updateDockerfile('Dockerfile', dockerfileContent, updates)

      expect(result).toContain('FROM node:18.19.0')
      expect(result).toContain('FROM alpine:3.19')
      expect(result).toContain('FROM ubuntu:22.04 as builder') // Should remain unchanged
    })

    it('should respect dynamic version indicators', async () => {
      const dockerfileContent = `
FROM node:latest
FROM alpine:stable
FROM ubuntu:22.04
`

      const updates = [
        {
          name: 'node',
          currentVersion: 'latest',
          newVersion: '18.19.0',
          updateType: 'major' as const,
          dependencyType: 'docker-image' as const,
          file: 'Dockerfile',
        },
        {
          name: 'alpine',
          currentVersion: 'stable',
          newVersion: '3.19',
          updateType: 'minor' as const,
          dependencyType: 'docker-image' as const,
          file: 'Dockerfile',
        },
        {
          name: 'ubuntu',
          currentVersion: '22.04',
          newVersion: '24.04',
          updateType: 'major' as const,
          dependencyType: 'docker-image' as const,
          file: 'Dockerfile',
        },
      ]

      const result = await updateDockerfile('Dockerfile', dockerfileContent, updates)

      // latest and stable should be respected (not updated)
      expect(result).toContain('FROM node:latest')
      expect(result).toContain('FROM alpine:stable')
      // Only ubuntu should be updated
      expect(result).toContain('FROM ubuntu:24.04')
    })

    it('should handle complex image names with registries', async () => {
      const dockerfileContent = `
FROM registry.example.com/namespace/image:v1.2.3
FROM docker.io/library/node:18.17.0
`

      const updates = [
        {
          name: 'registry.example.com/namespace/image',
          currentVersion: 'v1.2.3',
          newVersion: 'v1.3.0',
          updateType: 'minor' as const,
          dependencyType: 'docker-image' as const,
          file: 'Dockerfile',
        },
      ]

      const result = await updateDockerfile('Dockerfile', dockerfileContent, updates)

      expect(result).toContain('FROM registry.example.com/namespace/image:v1.3.0')
      expect(result).toContain('FROM docker.io/library/node:18.17.0') // Should remain unchanged
    })
  })
})
