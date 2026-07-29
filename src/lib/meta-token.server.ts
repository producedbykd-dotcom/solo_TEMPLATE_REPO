import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type MetaToken = {
  userAccessToken: string;
  pageId: string | null;
  pageName: string | null;
  pageAccessToken: string | null;
  igUserId: string | null;
  igUsername: string | null;
};

export async function getMetaConnection(userId: string): Promise<MetaToken> {
  const { data, error } = await supabaseAdmin
    .from("meta_connections")
    .select("user_access_token, page_id, page_name, page_access_token, ig_user_id, ig_username, token_expires_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("Meta not connected. Connect Facebook/Instagram from the Connections page.");
  if (data.token_expires_at && new Date(data.token_expires_at).getTime() < Date.now()) {
    throw new Error("Meta session expired. Reconnect from the Connections page.");
  }
  return {
    userAccessToken: data.user_access_token,
    pageId: data.page_id,
    pageName: data.page_name,
    pageAccessToken: data.page_access_token,
    igUserId: data.ig_user_id,
    igUsername: data.ig_username,
  };
}