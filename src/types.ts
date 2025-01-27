export interface WatchConfig {
  paths: string[]
  ignoreDirs?: string[]
  mode?: 'interactive' | 'daemon' // interactive by default
  onError?: (error: Error) => void
}
