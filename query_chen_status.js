import { createClient } from '@supabase/supabase-js'
import * as fs from 'fs'

const supabaseUrl = 'https://wcgdapjjzpzvjprzudyq.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZ2RhcGpqenB6dmpwcnp1ZHlxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc5NTc4ODEsImV4cCI6MjA4MzUzMzg4MX0._Nn91KgZjMCZfvr6189RY-GIy_l-PwZSAIrQ06SYJNY'

const supabase = createClient(supabaseUrl, supabaseKey)

async function checkChenStatus() {
  const result = {
    employee: null,
    requests: [],
    vehicles: []
  }

  const { data: employees } = await supabase
    .from('employees')
    .select('*')
    .eq('full_name', '陳英峻')

  if (employees && employees.length > 0) {
    result.employee = employees[0]
  }

  if (result.employee) {
    const { data: requests } = await supabase
      .from('leave_requests')
      .select('*')
      .eq('employee_id', result.employee.id)
      .order('start_time', { ascending: false })
      .limit(5)
    result.requests = requests || []

    const { data: vehBookings } = await supabase
      .from('vehicle_bookings')
      .select('*')
      .eq('employee_id', result.employee.id)
      .order('start_time', { ascending: false })
      .limit(5)
    result.vehicles = vehBookings || []
  }

  fs.writeFileSync('chen_result.json', JSON.stringify(result, null, 2))
}

checkChenStatus()
