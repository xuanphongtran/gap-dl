export type RoomRole = 'owner' | 'moderator' | 'member'
export type RoomVisibility = 'public' | 'private'
export type InvitationStatus = 'pending' | 'accepted' | 'declined'

export interface TokenPair {
  access_token: string
  refresh_token: string
  expires_at: number
}

export interface Profile {
  id: number
  username: string
  email: string
  avatar_url?: string
  created_at: string
}

export interface Room {
  id: number
  name: string
  visibility: RoomVisibility
  role: RoomRole | null
  created_by: number
  created_at: string
}

export interface Message {
  attachments?: AttachmentSummary[]
  id: number
  room_id: number
  user_id: number | null
  username: string
  content: string
  created_at: string
  revision: number
  edited_at: string | null
  deleted_at: string | null
}

export interface ReadState {
  room_id: number
  last_read_message_id: number
  unread_count: number
}

export interface Invitation {
  id: number
  room_id: number
  room_name: string
  invitee_id: number
  invited_by: number
  status: InvitationStatus
  created_at: string
  updated_at: string
  responded_at?: string
}

export interface RoomMember {
  room_id: number
  user_id: number
  username: string
  role: RoomRole
  joined_at: string
}

export interface SearchMessagesResponse {
  messages: Message[]
  next_before: number | null
}

export interface MessageSendOptions {
  attachmentIds?: number[]
  mentionUserIds: number[]
  idempotencyKey: string
}
export interface Notification {
  id: number
  kind: string
  room_id: number
  message_id: number
  created_at: string
  read_at: string | null
  availability: 'available' | 'deleted'
}
export interface NotificationFeed {
  notifications: Notification[]
  next_before: number | null
}
export interface NotificationPreferences {
  mentions_enabled: boolean
}
export interface RoomNotificationPreferences {
  muted: boolean
}

export interface AttachmentSummary {
  id: number
  filename: string
  content_type: string
  size_bytes: number
  sha256: string
  verified: boolean
}
export interface AttachmentMetadata extends AttachmentSummary {
  state: string
  created_at: string
  upload_expires_at: string
  expires_at: string | null
}
export interface AttachmentUploadRequest {
  filename: string
  content_type: string
  size_bytes: number
  sha256: string
}
export interface AttachmentUploadTicket {
  attachment: AttachmentMetadata
  method: string
  headers: Record<string, string>
  upload_url: string
}
export interface AttachmentDownloadTicket {
  download_url: string
  expires_at: string
}
