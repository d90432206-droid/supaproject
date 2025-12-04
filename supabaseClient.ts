
import { createClient } from '@supabase/supabase-js';

// 來自您的截圖資訊
const supabaseUrl = 'https://fbpdjnreljhfgmdflfjl.supabase.co';
const supabaseKey = 'sb_publishable_-0Fa_jGwSQDRHZ2DOTV8FA_UfeMSvrO';

export const supabase = createClient(supabaseUrl, supabaseKey);
