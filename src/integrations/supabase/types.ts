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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      billing_plans: {
        Row: {
          ai_cost_cap_cents: number | null
          amount_cents: number
          created_at: string
          credit_grant: number
          id: string
          interval: Database["public"]["Enums"]["billing_interval"]
          square_plan_id: string | null
          square_variation_id: string | null
          tier: Database["public"]["Enums"]["billing_tier"]
          updated_at: string
          upload_limit: number | null
        }
        Insert: {
          ai_cost_cap_cents?: number | null
          amount_cents: number
          created_at?: string
          credit_grant?: number
          id?: string
          interval: Database["public"]["Enums"]["billing_interval"]
          square_plan_id?: string | null
          square_variation_id?: string | null
          tier: Database["public"]["Enums"]["billing_tier"]
          updated_at?: string
          upload_limit?: number | null
        }
        Update: {
          ai_cost_cap_cents?: number | null
          amount_cents?: number
          created_at?: string
          credit_grant?: number
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          square_plan_id?: string | null
          square_variation_id?: string | null
          tier?: Database["public"]["Enums"]["billing_tier"]
          updated_at?: string
          upload_limit?: number | null
        }
        Relationships: []
      }
      chat_messages: {
        Row: {
          created_at: string
          id: string
          parts: Json
          project_id: string
          role: string
          section: Database["public"]["Enums"]["section_kind"]
        }
        Insert: {
          created_at?: string
          id?: string
          parts: Json
          project_id: string
          role: string
          section: Database["public"]["Enums"]["section_kind"]
        }
        Update: {
          created_at?: string
          id?: string
          parts?: Json
          project_id?: string
          role?: string
          section?: Database["public"]["Enums"]["section_kind"]
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_ledger: {
        Row: {
          created_at: string
          delta: number
          id: string
          metadata: Json | null
          project_id: string | null
          reason: string
          refunded_at: string | null
          subscription_id: string | null
          topup_id: string | null
          user_id: string
        }
        Insert: {
          created_at?: string
          delta: number
          id?: string
          metadata?: Json | null
          project_id?: string | null
          reason: string
          refunded_at?: string | null
          subscription_id?: string | null
          topup_id?: string | null
          user_id: string
        }
        Update: {
          created_at?: string
          delta?: number
          id?: string
          metadata?: Json | null
          project_id?: string | null
          reason?: string
          refunded_at?: string | null
          subscription_id?: string | null
          topup_id?: string | null
          user_id?: string
        }
        Relationships: []
      }
      credit_topups: {
        Row: {
          amount_cents: number
          created_at: string
          credits: number
          id: string
          paid_at: string | null
          sku: string
          square_payment_id: string | null
          square_payment_link_id: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount_cents: number
          created_at?: string
          credits: number
          id?: string
          paid_at?: string | null
          sku: string
          square_payment_id?: string | null
          square_payment_link_id?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount_cents?: number
          created_at?: string
          credits?: number
          id?: string
          paid_at?: string | null
          sku?: string
          square_payment_id?: string | null
          square_payment_link_id?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      free_downloads: {
        Row: {
          created_at: string
          email: string
          id: string
          product_id: string | null
          store_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          product_id?: string | null
          store_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          product_id?: string | null
          store_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "free_downloads_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "free_downloads_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      identities: {
        Row: {
          artist_name: string | null
          created_at: string
          default_tags: string[]
          description_template: string | null
          id: string
          image_style_prompt: string | null
          is_default: boolean
          links: Json
          name: string
          reference_image_paths: string[]
          updated_at: string
          user_id: string
        }
        Insert: {
          artist_name?: string | null
          created_at?: string
          default_tags?: string[]
          description_template?: string | null
          id?: string
          image_style_prompt?: string | null
          is_default?: boolean
          links?: Json
          name: string
          reference_image_paths?: string[]
          updated_at?: string
          user_id: string
        }
        Update: {
          artist_name?: string | null
          created_at?: string
          default_tags?: string[]
          description_template?: string | null
          id?: string
          image_style_prompt?: string | null
          is_default?: boolean
          links?: Json
          name?: string
          reference_image_paths?: string[]
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      marketing_assets: {
        Row: {
          key: string
          mime_type: string | null
          public_url: string | null
          size_bytes: number | null
          storage_path: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          mime_type?: string | null
          public_url?: string | null
          size_bytes?: number | null
          storage_path: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          key?: string
          mime_type?: string | null
          public_url?: string | null
          size_bytes?: number | null
          storage_path?: string
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      meta_connections: {
        Row: {
          created_at: string
          fb_user_id: string
          fb_user_name: string | null
          id: string
          ig_user_id: string | null
          ig_username: string | null
          page_access_token: string | null
          page_id: string | null
          page_name: string | null
          scope: string | null
          token_expires_at: string | null
          updated_at: string
          user_access_token: string
          user_id: string
        }
        Insert: {
          created_at?: string
          fb_user_id: string
          fb_user_name?: string | null
          id?: string
          ig_user_id?: string | null
          ig_username?: string | null
          page_access_token?: string | null
          page_id?: string | null
          page_name?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_access_token: string
          user_id: string
        }
        Update: {
          created_at?: string
          fb_user_id?: string
          fb_user_name?: string | null
          id?: string
          ig_user_id?: string | null
          ig_username?: string | null
          page_access_token?: string | null
          page_id?: string | null
          page_name?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_access_token?: string
          user_id?: string
        }
        Relationships: []
      }
      notify_signups: {
        Row: {
          created_at: string
          email: string
          id: string
          platform: string
          user_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          platform: string
          user_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          platform?: string
          user_id?: string | null
        }
        Relationships: []
      }
      payhip_subscriptions: {
        Row: {
          created_at: string
          customer_email: string
          is_active: boolean
          payhip_event_type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          customer_email: string
          is_active?: boolean
          payhip_event_type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          customer_email?: string
          is_active?: boolean
          payhip_event_type?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      product_tiers: {
        Row: {
          active: boolean
          created_at: string
          distribution_limit: number | null
          extra_terms: string | null
          id: string
          kind: string
          price_cents: number
          product_id: string
          sold_out: boolean
          stream_limit: number | null
          term_months: number | null
          updated_at: string
          video_limit: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string
          distribution_limit?: number | null
          extra_terms?: string | null
          id?: string
          kind: string
          price_cents?: number
          product_id: string
          sold_out?: boolean
          stream_limit?: number | null
          term_months?: number | null
          updated_at?: string
          video_limit?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string
          distribution_limit?: number | null
          extra_terms?: string | null
          id?: string
          kind?: string
          price_cents?: number
          product_id?: string
          sold_out?: boolean
          stream_limit?: number | null
          term_months?: number | null
          updated_at?: string
          video_limit?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "product_tiers_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          is_payhip_subscriber: boolean
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id: string
          is_payhip_subscriber?: boolean
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          is_payhip_subscriber?: boolean
          updated_at?: string
        }
        Relationships: []
      }
      project_assets: {
        Row: {
          bucket: string
          created_at: string
          id: string
          kind: Database["public"]["Enums"]["asset_kind"]
          meta: Json
          project_id: string
          storage_path: string
        }
        Insert: {
          bucket: string
          created_at?: string
          id?: string
          kind: Database["public"]["Enums"]["asset_kind"]
          meta?: Json
          project_id: string
          storage_path: string
        }
        Update: {
          bucket?: string
          created_at?: string
          id?: string
          kind?: Database["public"]["Enums"]["asset_kind"]
          meta?: Json
          project_id?: string
          storage_path?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_assets_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_sections: {
        Row: {
          approved_at: string | null
          data: Json
          id: string
          project_id: string
          section: Database["public"]["Enums"]["section_kind"]
          status: Database["public"]["Enums"]["section_status"]
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          data?: Json
          id?: string
          project_id: string
          section: Database["public"]["Enums"]["section_kind"]
          status?: Database["public"]["Enums"]["section_status"]
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          data?: Json
          id?: string
          project_id?: string
          section?: Database["public"]["Enums"]["section_kind"]
          status?: Database["public"]["Enums"]["section_status"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "project_sections_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      project_tracks: {
        Row: {
          audio_path: string
          chapter_start_sec: number | null
          created_at: string
          duration_sec: number | null
          id: string
          position: number
          project_id: string
          title: string | null
        }
        Insert: {
          audio_path: string
          chapter_start_sec?: number | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          position?: number
          project_id: string
          title?: string | null
        }
        Update: {
          audio_path?: string
          chapter_start_sec?: number | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          position?: number
          project_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "project_tracks_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      projects: {
        Row: {
          analysis_audio_path: string | null
          auto_chain_ran_at: string | null
          compilation_id: string | null
          cover_image_path: string | null
          cover_thumb_url: string | null
          created_at: string
          duration_sec: number | null
          first_published_at: string | null
          id: string
          identity_id: string | null
          integrated_lufs: number | null
          kind: Database["public"]["Enums"]["project_kind"]
          primary_audio_path: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["project_status"]
          title: string
          true_peak_dbtp: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          analysis_audio_path?: string | null
          auto_chain_ran_at?: string | null
          compilation_id?: string | null
          cover_image_path?: string | null
          cover_thumb_url?: string | null
          created_at?: string
          duration_sec?: number | null
          first_published_at?: string | null
          id?: string
          identity_id?: string | null
          integrated_lufs?: number | null
          kind?: Database["public"]["Enums"]["project_kind"]
          primary_audio_path?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          title?: string
          true_peak_dbtp?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          analysis_audio_path?: string | null
          auto_chain_ran_at?: string | null
          compilation_id?: string | null
          cover_image_path?: string | null
          cover_thumb_url?: string | null
          created_at?: string
          duration_sec?: number | null
          first_published_at?: string | null
          id?: string
          identity_id?: string | null
          integrated_lufs?: number | null
          kind?: Database["public"]["Enums"]["project_kind"]
          primary_audio_path?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["project_status"]
          title?: string
          true_peak_dbtp?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "projects_compilation_id_fkey"
            columns: ["compilation_id"]
            isOneToOne: false
            referencedRelation: "release_compilations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "projects_identity_id_fkey"
            columns: ["identity_id"]
            isOneToOne: false
            referencedRelation: "identities"
            referencedColumns: ["id"]
          },
        ]
      }
      publish_jobs: {
        Row: {
          created_at: string
          error: string | null
          id: string
          overrides: Json
          platform: Database["public"]["Enums"]["social_platform"]
          platform_post_id: string | null
          platform_url: string | null
          project_id: string
          published_at: string | null
          scheduled_for: string | null
          status: Database["public"]["Enums"]["publish_status"]
        }
        Insert: {
          created_at?: string
          error?: string | null
          id?: string
          overrides?: Json
          platform: Database["public"]["Enums"]["social_platform"]
          platform_post_id?: string | null
          platform_url?: string | null
          project_id: string
          published_at?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
        }
        Update: {
          created_at?: string
          error?: string | null
          id?: string
          overrides?: Json
          platform?: Database["public"]["Enums"]["social_platform"]
          platform_post_id?: string | null
          platform_url?: string | null
          project_id?: string
          published_at?: string | null
          scheduled_for?: string | null
          status?: Database["public"]["Enums"]["publish_status"]
        }
        Relationships: [
          {
            foreignKeyName: "publish_jobs_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      release_compilations: {
        Row: {
          cover_image_path: string | null
          created_at: string
          duration_sec: number | null
          id: string
          ordered_track_ids: string[]
          output_storage_path: string | null
          project_id: string | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          cover_image_path?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          ordered_track_ids: string[]
          output_storage_path?: string | null
          project_id?: string | null
          status?: string
          title: string
          updated_at?: string
          user_id: string
        }
        Update: {
          cover_image_path?: string | null
          created_at?: string
          duration_sec?: number | null
          id?: string
          ordered_track_ids?: string[]
          output_storage_path?: string | null
          project_id?: string | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "release_compilations_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      release_stats: {
        Row: {
          comments: number | null
          fetched_at: string
          id: string
          likes: number | null
          platform: Database["public"]["Enums"]["social_platform"]
          project_id: string
          views: number | null
        }
        Insert: {
          comments?: number | null
          fetched_at?: string
          id?: string
          likes?: number | null
          platform: Database["public"]["Enums"]["social_platform"]
          project_id: string
          views?: number | null
        }
        Update: {
          comments?: number | null
          fetched_at?: string
          id?: string
          likes?: number | null
          platform?: Database["public"]["Enums"]["social_platform"]
          project_id?: string
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "release_stats_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
        ]
      }
      social_connections: {
        Row: {
          access_token: string | null
          account_id: string | null
          account_name: string | null
          created_at: string
          expires_at: string | null
          id: string
          platform: Database["public"]["Enums"]["social_platform"]
          refresh_token: string | null
          scopes: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token?: string | null
          account_id?: string | null
          account_name?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          platform: Database["public"]["Enums"]["social_platform"]
          refresh_token?: string | null
          scopes?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string | null
          account_id?: string | null
          account_name?: string | null
          created_at?: string
          expires_at?: string | null
          id?: string
          platform?: Database["public"]["Enums"]["social_platform"]
          refresh_token?: string | null
          scopes?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      solo_licenses: {
        Row: {
          activated_at: string | null
          buyer_email: string
          github_username: string | null
          id: string
          issued_at: string
          key_hash: string
          license_key: string
          provisioned_at: string | null
          purchase_ref: string | null
          repo_url: string | null
          revoked_at: string | null
          user_id: string | null
        }
        Insert: {
          activated_at?: string | null
          buyer_email: string
          github_username?: string | null
          id?: string
          issued_at?: string
          key_hash: string
          license_key: string
          provisioned_at?: string | null
          purchase_ref?: string | null
          repo_url?: string | null
          revoked_at?: string | null
          user_id?: string | null
        }
        Update: {
          activated_at?: string | null
          buyer_email?: string
          github_username?: string | null
          id?: string
          issued_at?: string
          key_hash?: string
          license_key?: string
          provisioned_at?: string | null
          purchase_ref?: string | null
          repo_url?: string | null
          revoked_at?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      soundcloud_connections: {
        Row: {
          access_token: string
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          permalink_url: string | null
          refresh_token: string | null
          sc_user_id: string
          scope: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
          username: string | null
        }
        Insert: {
          access_token: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          permalink_url?: string | null
          refresh_token?: string | null
          sc_user_id: string
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
          username?: string | null
        }
        Update: {
          access_token?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          permalink_url?: string | null
          refresh_token?: string | null
          sc_user_id?: string
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
          username?: string | null
        }
        Relationships: []
      }
      soundcloud_oauth_pkce: {
        Row: {
          code_verifier: string
          created_at: string
          state: string
          user_id: string
        }
        Insert: {
          code_verifier: string
          created_at?: string
          state: string
          user_id: string
        }
        Update: {
          code_verifier?: string
          created_at?: string
          state?: string
          user_id?: string
        }
        Relationships: []
      }
      store_membership_plans: {
        Row: {
          active: boolean
          created_at: string
          description: string | null
          discount_percent: number
          download_quota: number
          id: string
          interval: string
          lease_quota: number
          mode: string
          name: string
          price_cents: number
          store_id: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          description?: string | null
          discount_percent?: number
          download_quota?: number
          id?: string
          interval?: string
          lease_quota?: number
          mode?: string
          name?: string
          price_cents?: number
          store_id: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          description?: string | null
          discount_percent?: number
          download_quota?: number
          id?: string
          interval?: string
          lease_quota?: number
          mode?: string
          name?: string
          price_cents?: number
          store_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_membership_plans_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_order_items: {
        Row: {
          created_at: string
          id: string
          license_pdf_path: string | null
          order_id: string
          price_cents: number
          product_id: string | null
          terms_snapshot: Json | null
          tier_id: string | null
          tier_kind: string
          title: string
          unit_price_cents: number
        }
        Insert: {
          created_at?: string
          id?: string
          license_pdf_path?: string | null
          order_id: string
          price_cents?: number
          product_id?: string | null
          terms_snapshot?: Json | null
          tier_id?: string | null
          tier_kind: string
          title: string
          unit_price_cents?: number
        }
        Update: {
          created_at?: string
          id?: string
          license_pdf_path?: string | null
          order_id?: string
          price_cents?: number
          product_id?: string | null
          terms_snapshot?: Json | null
          tier_id?: string | null
          tier_kind?: string
          title?: string
          unit_price_cents?: number
        }
        Relationships: [
          {
            foreignKeyName: "store_order_items_order_id_fkey"
            columns: ["order_id"]
            isOneToOne: false
            referencedRelation: "store_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_order_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "store_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_order_items_tier_id_fkey"
            columns: ["tier_id"]
            isOneToOne: false
            referencedRelation: "product_tiers"
            referencedColumns: ["id"]
          },
        ]
      }
      store_orders: {
        Row: {
          buyer_email: string
          buyer_name: string
          created_at: string
          currency: string
          discount_cents: number
          id: string
          ipn_raw: Json | null
          paid_at: string | null
          paypal_payer_email: string | null
          paypal_txn_id: string | null
          promo_snapshot: Json | null
          status: string
          store_id: string
          subtotal_cents: number
          token: string
          total_cents: number
          updated_at: string
        }
        Insert: {
          buyer_email: string
          buyer_name: string
          created_at?: string
          currency?: string
          discount_cents?: number
          id?: string
          ipn_raw?: Json | null
          paid_at?: string | null
          paypal_payer_email?: string | null
          paypal_txn_id?: string | null
          promo_snapshot?: Json | null
          status?: string
          store_id: string
          subtotal_cents?: number
          token: string
          total_cents?: number
          updated_at?: string
        }
        Update: {
          buyer_email?: string
          buyer_name?: string
          created_at?: string
          currency?: string
          discount_cents?: number
          id?: string
          ipn_raw?: Json | null
          paid_at?: string | null
          paypal_payer_email?: string | null
          paypal_txn_id?: string | null
          promo_snapshot?: Json | null
          status?: string
          store_id?: string
          subtotal_cents?: number
          token?: string
          total_cents?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_orders_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_products: {
        Row: {
          active: boolean
          artwork_path: string | null
          audio_bucket: string
          audio_path: string | null
          created_at: string
          description: string | null
          free_download_enabled: boolean
          free_download_path: string | null
          id: string
          kind: string
          position: number
          preview_path: string | null
          project_id: string | null
          store_id: string
          title: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          artwork_path?: string | null
          audio_bucket?: string
          audio_path?: string | null
          created_at?: string
          description?: string | null
          free_download_enabled?: boolean
          free_download_path?: string | null
          id?: string
          kind?: string
          position?: number
          preview_path?: string | null
          project_id?: string | null
          store_id: string
          title: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          artwork_path?: string | null
          audio_bucket?: string
          audio_path?: string | null
          created_at?: string
          description?: string | null
          free_download_enabled?: boolean
          free_download_path?: string | null
          id?: string
          kind?: string
          position?: number
          preview_path?: string | null
          project_id?: string | null
          store_id?: string
          title?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_products_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "store_products_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_promotions: {
        Row: {
          active: boolean
          bogo_buy: number
          bogo_free: number
          created_at: string
          ends_at: string | null
          exclude_exclusive: boolean
          headline: string | null
          id: string
          percent: number
          scope: string
          store_id: string
          type: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          bogo_buy?: number
          bogo_free?: number
          created_at?: string
          ends_at?: string | null
          exclude_exclusive?: boolean
          headline?: string | null
          id?: string
          percent?: number
          scope?: string
          store_id: string
          type?: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          bogo_buy?: number
          bogo_free?: number
          created_at?: string
          ends_at?: string | null
          exclude_exclusive?: boolean
          headline?: string | null
          id?: string
          percent?: number
          scope?: string
          store_id?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_promotions_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_stripe_config: {
        Row: {
          secret_key: string | null
          store_id: string
          updated_at: string
          webhook_secret: string | null
        }
        Insert: {
          secret_key?: string | null
          store_id: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Update: {
          secret_key?: string | null
          store_id?: string
          updated_at?: string
          webhook_secret?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "store_stripe_config_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: true
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      store_subscribers: {
        Row: {
          access_token: string
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          downloads_used: number
          email: string
          id: string
          leases_used: number
          status: string
          store_id: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          updated_at: string
        }
        Insert: {
          access_token: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          downloads_used?: number
          email: string
          id?: string
          leases_used?: number
          status?: string
          store_id: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          downloads_used?: number
          email?: string
          id?: string
          leases_used?: number
          status?: string
          store_id?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_subscribers_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "stores"
            referencedColumns: ["id"]
          },
        ]
      }
      stores: {
        Row: {
          accent: string
          bio: string | null
          created_at: string
          currency: string
          display_name: string
          handle: string
          id: string
          logo_path: string | null
          paypal_email: string | null
          paypal_verified_at: string | null
          published: boolean
          theme: string
          updated_at: string
          user_id: string
        }
        Insert: {
          accent?: string
          bio?: string | null
          created_at?: string
          currency?: string
          display_name?: string
          handle: string
          id?: string
          logo_path?: string | null
          paypal_email?: string | null
          paypal_verified_at?: string | null
          published?: boolean
          theme?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          accent?: string
          bio?: string | null
          created_at?: string
          currency?: string
          display_name?: string
          handle?: string
          id?: string
          logo_path?: string | null
          paypal_email?: string | null
          paypal_verified_at?: string | null
          published?: boolean
          theme?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      subscriptions: {
        Row: {
          ai_cost_cents_this_period: number
          canceled_at: string | null
          created_at: string
          current_period_end: string | null
          current_period_start: string | null
          id: string
          interval: Database["public"]["Enums"]["billing_interval"]
          kind: string
          square_customer_id: string | null
          square_payment_link_id: string | null
          square_subscription_id: string | null
          status: Database["public"]["Enums"]["subscription_status"]
          test_drive_analysis_regens_used: number
          test_drive_image_regens_used: number
          test_drive_uploads_used: number
          tier: Database["public"]["Enums"]["billing_tier"]
          updated_at: string
          uploads_this_period: number
          user_id: string
        }
        Insert: {
          ai_cost_cents_this_period?: number
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          interval: Database["public"]["Enums"]["billing_interval"]
          kind?: string
          square_customer_id?: string | null
          square_payment_link_id?: string | null
          square_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          test_drive_analysis_regens_used?: number
          test_drive_image_regens_used?: number
          test_drive_uploads_used?: number
          tier: Database["public"]["Enums"]["billing_tier"]
          updated_at?: string
          uploads_this_period?: number
          user_id: string
        }
        Update: {
          ai_cost_cents_this_period?: number
          canceled_at?: string | null
          created_at?: string
          current_period_end?: string | null
          current_period_start?: string | null
          id?: string
          interval?: Database["public"]["Enums"]["billing_interval"]
          kind?: string
          square_customer_id?: string | null
          square_payment_link_id?: string | null
          square_subscription_id?: string | null
          status?: Database["public"]["Enums"]["subscription_status"]
          test_drive_analysis_regens_used?: number
          test_drive_image_regens_used?: number
          test_drive_uploads_used?: number
          tier?: Database["public"]["Enums"]["billing_tier"]
          updated_at?: string
          uploads_this_period?: number
          user_id?: string
        }
        Relationships: []
      }
      tiktok_connections: {
        Row: {
          access_token: string
          avatar_url: string | null
          created_at: string
          display_name: string | null
          id: string
          open_id: string
          refresh_expires_at: string | null
          refresh_token: string | null
          scope: string | null
          token_expires_at: string | null
          union_id: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          open_id: string
          refresh_expires_at?: string | null
          refresh_token?: string | null
          scope?: string | null
          token_expires_at?: string | null
          union_id?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          avatar_url?: string | null
          created_at?: string
          display_name?: string | null
          id?: string
          open_id?: string
          refresh_expires_at?: string | null
          refresh_token?: string | null
          scope?: string | null
          token_expires_at?: string | null
          union_id?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_credits: {
        Row: {
          balance: number
          lifetime_granted: number
          lifetime_spent: number
          plan_grant: number
          updated_at: string
          user_id: string
        }
        Insert: {
          balance?: number
          lifetime_granted?: number
          lifetime_spent?: number
          plan_grant?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          balance?: number
          lifetime_granted?: number
          lifetime_spent?: number
          plan_grant?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
      youtube_connections: {
        Row: {
          access_token: string
          channel_id: string
          channel_thumbnail: string | null
          channel_title: string
          created_at: string
          id: string
          refresh_token: string | null
          scope: string | null
          token_expires_at: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          access_token: string
          channel_id: string
          channel_thumbnail?: string | null
          channel_title: string
          created_at?: string
          id?: string
          refresh_token?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          access_token?: string
          channel_id?: string
          channel_thumbnail?: string | null
          channel_title?: string
          created_at?: string
          id?: string
          refresh_token?: string | null
          scope?: string | null
          token_expires_at?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      get_credit_history: {
        Args: { _limit?: number }
        Returns: {
          created_at: string
          delta: number
          id: string
          project_id: string
          reason: string
          refunded_at: string
        }[]
      }
      grant_credits: {
        Args: {
          _amount: number
          _metadata?: Json
          _plan_grant?: number
          _reason: string
          _subscription_id?: string
          _topup_id?: string
          _user_id: string
        }
        Returns: string
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      propagate_payhip_status: {
        Args: { _email: string; _is_active: boolean }
        Returns: undefined
      }
      refund_credits: {
        Args: { _ledger_id: string; _reason?: string }
        Returns: boolean
      }
      spend_credits: {
        Args: {
          _amount: number
          _metadata?: Json
          _project_id?: string
          _reason: string
          _user_id: string
        }
        Returns: string
      }
      user_entitlement: {
        Args: { _user_id: string }
        Returns: {
          credits: number
          entitled: boolean
          plan_grant: number
          source: string
          tier: string
          uploads_remaining: number
        }[]
      }
    }
    Enums: {
      app_role: "admin" | "user"
      asset_kind:
        | "audio"
        | "thumbnail"
        | "cover"
        | "longform_video"
        | "short_video"
        | "album_art"
      billing_interval: "monthly" | "yearly" | "one_time"
      billing_tier: "starter" | "pro" | "label" | "test_drive"
      project_kind: "single" | "compilation_video" | "compilation_playlist"
      project_status:
        | "draft"
        | "in_progress"
        | "scheduled"
        | "published"
        | "archived"
      publish_status:
        | "queued"
        | "scheduled"
        | "uploading"
        | "published"
        | "failed"
      section_kind:
        | "track"
        | "analysis"
        | "keywords"
        | "metadata"
        | "tags"
        | "thumbnail"
        | "cover"
        | "longform"
        | "shorts"
        | "publish"
        | "artwork"
        | "music_stats"
      section_status: "pending" | "running" | "ready" | "approved" | "error"
      social_platform:
        | "youtube"
        | "instagram"
        | "facebook"
        | "tiktok"
        | "soundcloud"
      subscription_status:
        | "active"
        | "past_due"
        | "canceled"
        | "paused"
        | "pending"
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "user"],
      asset_kind: [
        "audio",
        "thumbnail",
        "cover",
        "longform_video",
        "short_video",
        "album_art",
      ],
      billing_interval: ["monthly", "yearly", "one_time"],
      billing_tier: ["starter", "pro", "label", "test_drive"],
      project_kind: ["single", "compilation_video", "compilation_playlist"],
      project_status: [
        "draft",
        "in_progress",
        "scheduled",
        "published",
        "archived",
      ],
      publish_status: [
        "queued",
        "scheduled",
        "uploading",
        "published",
        "failed",
      ],
      section_kind: [
        "track",
        "analysis",
        "keywords",
        "metadata",
        "tags",
        "thumbnail",
        "cover",
        "longform",
        "shorts",
        "publish",
        "artwork",
        "music_stats",
      ],
      section_status: ["pending", "running", "ready", "approved", "error"],
      social_platform: [
        "youtube",
        "instagram",
        "facebook",
        "tiktok",
        "soundcloud",
      ],
      subscription_status: [
        "active",
        "past_due",
        "canceled",
        "paused",
        "pending",
      ],
    },
  },
} as const
