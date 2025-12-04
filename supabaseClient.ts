
import { createClient } from '@supabase/supabase-js';
import { CONFIG } from './config';

// 使用 config.ts 中的設定進行初始化
export const supabase = createClient(CONFIG.SUPABASE.URL, CONFIG.SUPABASE.KEY);
