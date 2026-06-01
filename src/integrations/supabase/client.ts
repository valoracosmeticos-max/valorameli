// MANUALLY OVERRIDDEN: apontando para Supabase próprio do usuário (bjljokggqflvzlenfbps)
// e NÃO para o Lovable Cloud (bulaobebfuruerltzbbe) ao qual este projeto Lovable continua vinculado.
// Caso o Lovable regenere este arquivo, reaplique este override.
import { createClient } from '@supabase/supabase-js';
import type { Database } from './types';

const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL ?? 'https://bjljokggqflvzlenfbps.supabase.co';
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
  'sb_publishable_Rbdht1a5vu3Sj3rvkOmqpQ_4Tjyu8P7';

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";

export const supabase = createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  }
});