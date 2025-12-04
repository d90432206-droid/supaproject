
import { createClient } from '@supabase/supabase-js';

// 請填入您的 Supabase URL 和 Anon Key
const supabaseUrl = 'YOUR_SUPABASE_URL';
const supabaseKey = 'YOUR_SUPABASE_ANON_KEY';

export const supabase = createClient(supabaseUrl, supabaseKey);
