import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://wcgdapjjzpzvjprzudyq.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZ2RhcGpqenB6dmpwcnp1ZHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NTc4ODEsImV4cCI6MjA4MzUzMzg4MX0._Nn91KgZjMCZfvr6189RY-GIy_l-PwZSAIrQ06SYJNY'
const supabase = createClient(supabaseUrl, supabaseKey)

async function runAutoClose() {
  console.log('🚗 尋找所有逾期未歸還的車輛借用單...\n')
  
  const now = new Date().toISOString()
  
  // 1. 取得所有狀態為 approved (未歸還) 並且 end_time 已過的借用單
  const { data: overdueBookings, error: err1 } = await supabase
    .from('vehicle_bookings')
    .select('id, vehicle_id, employee_id, purpose, end_time, vehicles(plate_number), employees(full_name)')
    .eq('status', 'approved')
    .lte('end_time', now)

  if (err1) {
    console.error('查詢失敗:', err1)
    return
  }

  if (!overdueBookings || overdueBookings.length === 0) {
    console.log('✅ 目前沒有逾期未歸還的車輛')
    return
  }

  console.log(`⚠️ 發現 ${overdueBookings.length} 筆逾期借用單，準備自動結案：\n`)
  
  for (const booking of overdueBookings) {
    console.log(`處理中: [${booking.employees?.full_name}] 借用的 ${booking.vehicles?.plate_number} (單號: ${booking.id})`)
    
    // a. 結案該借出單，標記為「系統自動結案(遺漏歸還)」
    const { error: errUpdateBooking } = await supabase
      .from('vehicle_bookings')
      .update({
        status: 'returned',
        returned_at: now,
        return_condition: '系統自動結案(遺漏歸還)'
      })
      .eq('id', booking.id)

    if (errUpdateBooking) {
      console.error(`❌ 更新借用單 ${booking.id} 失敗:`, errUpdateBooking)
      continue
    }

    // b. 解除人員的 "out" 狀態 (前提是他目前還是 out，且 expected_return 跟這台車時間差不多)
    // 簡單一點，直接只要他是 out，就切回 in_office
    const { error: errUpdateEmp } = await supabase
      .from('employees')
      .update({
        current_status: 'in_office',
        expected_return: null,
        location_detail: null
      })
      .eq('id', booking.employee_id)
      .eq('current_status', 'out') // 只有在外出的才切回辦公室

    if (errUpdateEmp) {
      console.error(`❌ 更新員工狀態失敗:`, errUpdateEmp)
    } else {
      console.log(`✅ [${booking.employees?.full_name}] 狀態已重置為在公司。`)
    }
    
    // c. 如果要更完整，其實還要更新 vehicle 的 is_available 為 true
    const { error: errUpdateVeh } = await supabase
      .from('vehicles')
      .update({ is_available: true })
      .eq('id', booking.vehicle_id)
      
    if (errUpdateVeh) {
      console.error(`❌ 更新車輛狀態失敗:`, errUpdateVeh)
    } else {
      console.log(`✅ ${booking.vehicles?.plate_number} 已重置為可借用狀態。`)
    }
    console.log('-----------------------------------')
  }
  
  console.log('🎉 所有逾期借用單處理完畢！')
}

runAutoClose().then(() => process.exit(0))
