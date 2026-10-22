export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  graphql_public: {
    Tables: {
      [_ in never]: never
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      graphql: {
        Args: {
          extensions?: Json
          operationName?: string
          query?: string
          variables?: Json
        }
        Returns: Json
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
  public: {
    Tables: {
      ai_usage_daily: {
        Row: {
          created_at: string
          est_cost_usd: number
          group_id: string
          input_tokens: number
          output_tokens: number
          reply_count: number
          updated_at: string
          usage_date: string
        }
        Insert: {
          created_at?: string
          est_cost_usd?: number
          group_id: string
          input_tokens?: number
          output_tokens?: number
          reply_count?: number
          updated_at?: string
          usage_date: string
        }
        Update: {
          created_at?: string
          est_cost_usd?: number
          group_id?: string
          input_tokens?: number
          output_tokens?: number
          reply_count?: number
          updated_at?: string
          usage_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_usage_daily_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          created_at: string
          id: string
          incident_key: string
          kind: string
          resolved_at: string | null
          sent_at: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          incident_key: string
          kind: string
          resolved_at?: string | null
          sent_at?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          incident_key?: string
          kind?: string
          resolved_at?: string | null
          sent_at?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      authorized_user_groups: {
        Row: {
          authorized_user_id: string
          created_at: string
          group_id: string
        }
        Insert: {
          authorized_user_id: string
          created_at?: string
          group_id: string
        }
        Update: {
          authorized_user_id?: string
          created_at?: string
          group_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "authorized_user_groups_authorized_user_id_fkey"
            columns: ["authorized_user_id"]
            isOneToOne: false
            referencedRelation: "authorized_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "authorized_user_groups_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      authorized_users: {
        Row: {
          all_groups: boolean
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          phone_e164: string
          updated_at: string
        }
        Insert: {
          all_groups?: boolean
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          phone_e164: string
          updated_at?: string
        }
        Update: {
          all_groups?: boolean
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          phone_e164?: string
          updated_at?: string
        }
        Relationships: []
      }
      bot_actions: {
        Row: {
          action: string
          actor_ref: string | null
          actor_type: string
          created_at: string
          detail: Json
          group_id: string | null
          id: string
          source_wa_message_id: string | null
        }
        Insert: {
          action: string
          actor_ref?: string | null
          actor_type: string
          created_at?: string
          detail?: Json
          group_id?: string | null
          id?: string
          source_wa_message_id?: string | null
        }
        Update: {
          action?: string
          actor_ref?: string | null
          actor_type?: string
          created_at?: string
          detail?: Json
          group_id?: string | null
          id?: string
          source_wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "bot_actions_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      company_settings: {
        Row: {
          ai_chat_model: string | null
          ai_fallback_model: string | null
          bot_display_name: string
          company_name: string
          created_at: string
          id: number
          openrouter_key_hint: string | null
          owner_alert_phone: string | null
          timezone: string
          updated_at: string
        }
        Insert: {
          ai_chat_model?: string | null
          ai_fallback_model?: string | null
          bot_display_name?: string
          company_name: string
          created_at?: string
          id?: number
          openrouter_key_hint?: string | null
          owner_alert_phone?: string | null
          timezone: string
          updated_at?: string
        }
        Update: {
          ai_chat_model?: string | null
          ai_fallback_model?: string | null
          bot_display_name?: string
          company_name?: string
          created_at?: string
          id?: number
          openrouter_key_hint?: string | null
          owner_alert_phone?: string | null
          timezone?: string
          updated_at?: string
        }
        Relationships: []
      }
      dashboard_users: {
        Row: {
          created_at: string
          display_name: string
          role: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          display_name: string
          role: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          display_name?: string
          role?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      group_messages: {
        Row: {
          body: string | null
          created_at: string
          embedding: string | null
          embedding_status: string
          group_id: string
          handled_status: string | null
          id: string
          is_from_bot: boolean
          mentions_bot: boolean
          message_type: string
          quoted_wa_message_id: string | null
          sender_jid: string
          sender_name: string | null
          sender_phone_e164: string | null
          sent_at: string
          tsv: unknown
          updated_at: string
          wa_message_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          embedding?: string | null
          embedding_status?: string
          group_id: string
          handled_status?: string | null
          id?: string
          is_from_bot?: boolean
          mentions_bot?: boolean
          message_type: string
          quoted_wa_message_id?: string | null
          sender_jid: string
          sender_name?: string | null
          sender_phone_e164?: string | null
          sent_at: string
          tsv?: unknown
          updated_at?: string
          wa_message_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          embedding?: string | null
          embedding_status?: string
          group_id?: string
          handled_status?: string | null
          id?: string
          is_from_bot?: boolean
          mentions_bot?: boolean
          message_type?: string
          quoted_wa_message_id?: string | null
          sender_jid?: string
          sender_name?: string | null
          sender_phone_e164?: string | null
          sent_at?: string
          tsv?: unknown
          updated_at?: string
          wa_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "group_messages_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
        ]
      }
      groups: {
        Row: {
          ai_enabled: boolean
          approved_at: string | null
          approved_by: string | null
          bot_instructions: string | null
          created_at: string
          daily_reply_cap: number
          id: string
          last_activity_at: string | null
          name: string
          reminder_permission: string
          retention_days: number | null
          status: string
          updated_at: string
          wa_group_jid: string
        }
        Insert: {
          ai_enabled?: boolean
          approved_at?: string | null
          approved_by?: string | null
          bot_instructions?: string | null
          created_at?: string
          daily_reply_cap?: number
          id?: string
          last_activity_at?: string | null
          name: string
          reminder_permission?: string
          retention_days?: number | null
          status?: string
          updated_at?: string
          wa_group_jid: string
        }
        Update: {
          ai_enabled?: boolean
          approved_at?: string | null
          approved_by?: string | null
          bot_instructions?: string | null
          created_at?: string
          daily_reply_cap?: number
          id?: string
          last_activity_at?: string | null
          name?: string
          reminder_permission?: string
          retention_days?: number | null
          status?: string
          updated_at?: string
          wa_group_jid?: string
        }
        Relationships: [
          {
            foreignKeyName: "groups_approved_by_fkey"
            columns: ["approved_by"]
            isOneToOne: false
            referencedRelation: "dashboard_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      knowledge_entries: {
        Row: {
          content: string
          created_at: string
          embedding: string | null
          embedding_status: string
          group_id: string
          id: string
          is_active: boolean
          title: string
          tsv: unknown
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          content: string
          created_at?: string
          embedding?: string | null
          embedding_status?: string
          group_id: string
          id?: string
          is_active?: boolean
          title: string
          tsv?: unknown
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          content?: string
          created_at?: string
          embedding?: string | null
          embedding_status?: string
          group_id?: string
          id?: string
          is_active?: boolean
          title?: string
          tsv?: unknown
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_entries_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_entries_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "dashboard_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pairing_requests: {
        Row: {
          code_expires_at: string | null
          created_at: string
          error: string | null
          id: string
          kind: string
          pairing_code: string | null
          phone_e164: string
          requested_by: string
          status: string
          updated_at: string
        }
        Insert: {
          code_expires_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind: string
          pairing_code?: string | null
          phone_e164: string
          requested_by: string
          status?: string
          updated_at?: string
        }
        Update: {
          code_expires_at?: string | null
          created_at?: string
          error?: string | null
          id?: string
          kind?: string
          pairing_code?: string | null
          phone_e164?: string
          requested_by?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pairing_requests_requested_by_fkey"
            columns: ["requested_by"]
            isOneToOne: false
            referencedRelation: "dashboard_users"
            referencedColumns: ["user_id"]
          },
        ]
      }
      pending_reminder_requests: {
        Row: {
          confirmation_wa_message_id: string | null
          created_at: string
          draft_body: string
          draft_due_at: string
          expires_at: string
          group_id: string
          id: string
          requester_jid: string
          requester_phone_e164: string | null
          scheduled_post_id: string | null
          source_wa_message_id: string
          status: string
          updated_at: string
        }
        Insert: {
          confirmation_wa_message_id?: string | null
          created_at?: string
          draft_body: string
          draft_due_at: string
          expires_at: string
          group_id: string
          id?: string
          requester_jid: string
          requester_phone_e164?: string | null
          scheduled_post_id?: string | null
          source_wa_message_id: string
          status?: string
          updated_at?: string
        }
        Update: {
          confirmation_wa_message_id?: string | null
          created_at?: string
          draft_body?: string
          draft_due_at?: string
          expires_at?: string
          group_id?: string
          id?: string
          requester_jid?: string
          requester_phone_e164?: string | null
          scheduled_post_id?: string | null
          source_wa_message_id?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "pending_reminder_requests_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "pending_reminder_requests_scheduled_post_id_fkey"
            columns: ["scheduled_post_id"]
            isOneToOne: false
            referencedRelation: "scheduled_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      scheduled_posts: {
        Row: {
          body: string
          claim_token: string | null
          claimed_at: string | null
          created_at: string
          created_by_phone_e164: string | null
          created_by_user_id: string | null
          created_via: string
          due_at: string
          group_id: string
          id: string
          kind: string
          last_error: string | null
          parent_post_id: string | null
          recurrence_rule: string | null
          sent_at: string | null
          sent_late: boolean
          status: string
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          body: string
          claim_token?: string | null
          claimed_at?: string | null
          created_at?: string
          created_by_phone_e164?: string | null
          created_by_user_id?: string | null
          created_via: string
          due_at: string
          group_id: string
          id?: string
          kind: string
          last_error?: string | null
          parent_post_id?: string | null
          recurrence_rule?: string | null
          sent_at?: string | null
          sent_late?: boolean
          status?: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          body?: string
          claim_token?: string | null
          claimed_at?: string | null
          created_at?: string
          created_by_phone_e164?: string | null
          created_by_user_id?: string | null
          created_via?: string
          due_at?: string
          group_id?: string
          id?: string
          kind?: string
          last_error?: string | null
          parent_post_id?: string | null
          recurrence_rule?: string | null
          sent_at?: string | null
          sent_late?: boolean
          status?: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "scheduled_posts_created_by_user_id_fkey"
            columns: ["created_by_user_id"]
            isOneToOne: false
            referencedRelation: "dashboard_users"
            referencedColumns: ["user_id"]
          },
          {
            foreignKeyName: "scheduled_posts_group_id_fkey"
            columns: ["group_id"]
            isOneToOne: false
            referencedRelation: "groups"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "scheduled_posts_parent_post_id_fkey"
            columns: ["parent_post_id"]
            isOneToOne: false
            referencedRelation: "scheduled_posts"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_auth_state: {
        Row: {
          created_at: string
          key: string
          updated_at: string
          value_enc: string
        }
        Insert: {
          created_at?: string
          key: string
          updated_at?: string
          value_enc: string
        }
        Update: {
          created_at?: string
          key?: string
          updated_at?: string
          value_enc?: string
        }
        Relationships: []
      }
      wa_connection: {
        Row: {
          bot_jid: string | null
          bot_lid: string | null
          created_at: string
          id: number
          instance_id: string | null
          last_connected_at: string | null
          last_error: string | null
          last_heartbeat_at: string | null
          linked_phone_e164: string | null
          status: string
          updated_at: string
        }
        Insert: {
          bot_jid?: string | null
          bot_lid?: string | null
          created_at?: string
          id?: number
          instance_id?: string | null
          last_connected_at?: string | null
          last_error?: string | null
          last_heartbeat_at?: string | null
          linked_phone_e164?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          bot_jid?: string | null
          bot_lid?: string | null
          created_at?: string
          id?: number
          instance_id?: string | null
          last_connected_at?: string | null
          last_error?: string | null
          last_heartbeat_at?: string | null
          linked_phone_e164?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      worker_lock: {
        Row: {
          created_at: string
          holder: string | null
          id: number
          lease_expires_at: string
        }
        Insert: {
          created_at?: string
          holder?: string | null
          id?: number
          lease_expires_at?: string
        }
        Update: {
          created_at?: string
          holder?: string | null
          id?: number
          lease_expires_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      acquire_worker_lock: {
        Args: { p_instance: string; p_lease_seconds?: number }
        Returns: boolean
      }
      check_worker_offline: { Args: never; Returns: undefined }
      clear_openrouter_key: { Args: never; Returns: undefined }
      claim_due_posts: {
        Args: { p_claim_token: string; p_limit?: number }
        Returns: {
          body: string
          claim_token: string | null
          claimed_at: string | null
          created_at: string
          created_by_phone_e164: string | null
          created_by_user_id: string | null
          created_via: string
          due_at: string
          group_id: string
          id: string
          kind: string
          last_error: string | null
          parent_post_id: string | null
          recurrence_rule: string | null
          sent_at: string | null
          sent_late: boolean
          status: string
          updated_at: string
          wa_message_id: string | null
        }[]
        SetofOptions: {
          from: "*"
          to: "scheduled_posts"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      configure_alert_email: {
        Args: { p_api_key: string; p_from: string; p_recipients: string[] }
        Returns: undefined
      }
      current_dashboard_role: { Args: never; Returns: string }
      get_openrouter_key: { Args: never; Returns: string }
      record_ai_usage: {
        Args: {
          p_cost_usd: number
          p_group_id: string
          p_input_tokens: number
          p_output_tokens: number
          p_replies?: number
          p_usage_date: string
        }
        Returns: undefined
      }
      search_group_history: {
        Args: {
          p_group_id: string
          p_limit?: number
          p_query_embedding: string
          p_query_text: string
        }
        Returns: {
          body: string
          id: string
          score: number
          sender_name: string
          sent_at: string
          wa_message_id: string
        }[]
      }
      search_knowledge: {
        Args: {
          p_group_id: string
          p_limit?: number
          p_query_embedding: string
          p_query_text: string
        }
        Returns: {
          content: string
          id: string
          score: number
          title: string
        }[]
      }
      set_openrouter_key: { Args: { p_key: string }; Returns: undefined }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const
