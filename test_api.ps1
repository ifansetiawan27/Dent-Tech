$ErrorActionPreference = 'Stop'
$base = 'http://localhost:3000'
$pass = 0; $fail = 0
function Ok($m){ $script:pass++; Write-Output "  [PASS] $m" }
function Bad($m){ $script:fail++; Write-Output "  [FAIL] $m" }
function H($t){ @{ Authorization = "Bearer $t" } }
function J($o){ $o | ConvertTo-Json -Depth 10 }
function Req($method, $uri, $token, $body) {
  $headers = @{}
  if ($token) { $headers['Authorization'] = "Bearer $token" }
  $args = @{ Method = $method; Uri = $uri; Headers = $headers }
  if ($body) { $args['Body'] = ($body | ConvertTo-Json -Depth 10); $args['ContentType'] = 'application/json' }
  try { return Invoke-RestMethod @args }
  catch {
    $resp = $_.Exception.Response
    $code = [int]$resp.StatusCode
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
    $txt = $reader.ReadToEnd()
    return @{ __error = $true; code = $code; body = $txt }
  }
}

Write-Output "=== 1. AUTH ==="
$admin = Req 'POST' "$base/api/auth/login" $null @{email='admin@denttech.id';password='admin123'}
if ($admin.token) { Ok "admin login"; $AT=$admin.token } else { Bad "admin login" }
$tech = Req 'POST' "$base/api/auth/login" $null @{email='budi@denttech.id';password='tech123'}
if ($tech.token) { Ok "technician login"; $TT=$tech.token } else { Bad "technician login" }
$cust = Req 'POST' "$base/api/auth/login" $null @{email='hendra@denttech.id';password='customer123'}
if ($cust.token) { Ok "customer login (hendra/RS Medika Farma)"; $CT=$cust.token } else { Bad "customer login" }
$badlogin = Req 'POST' "$base/api/auth/login" $null @{email='admin@denttech.id';password='wrong'}
if ($badlogin.__error -and $badlogin.code -eq 401) { Ok "wrong password rejected 401" } else { Bad "wrong password should 401" }
$noauth = Req 'GET' "$base/api/tickets" $null $null
if ($noauth.__error -and $noauth.code -eq 401) { Ok "unauthenticated rejected 401" } else { Bad "unauthenticated should 401" }

Write-Output "=== 2. RBAC ==="
$rbac = Req 'GET' "$base/api/users" $CT $null
if ($rbac.__error -and $rbac.code -eq 403) { Ok "customer blocked from /users 403" } else { Bad "customer should be blocked from /users" }

Write-Output "=== 3. ADMIN DASHBOARD ==="
$dash = Req 'GET' "$base/api/dashboard" $AT $null
if ($dash.stats.openTickets -ge 1) { Ok "admin dashboard openTickets=$($dash.stats.openTickets)" } else { Bad "admin dashboard" }

Write-Output "=== 4. TICKETS ==="
$tickets = Req 'GET' "$base/api/tickets" $AT $null
if ($tickets.total -ge 4) { Ok "list tickets total=$($tickets.total)" } else { Bad "list tickets" }
$openTicket = $tickets.tickets | Where-Object { $_.status -eq 'OPEN' } | Select-Object -First 1
if ($openTicket) { Ok "found OPEN ticket $($openTicket.number)" } else { Bad "no OPEN ticket" }
$detail = Req 'GET' "$base/api/tickets/$($openTicket.id)" $AT $null
if ($detail.ticket.number -eq $openTicket.number) { Ok "ticket detail" } else { Bad "ticket detail" }

Write-Output "=== 5. ASSIGN TECHNICIAN ==="
$techs = Req 'GET' "$base/api/users?role=technician" $AT $null
$techId = ($techs.users | Where-Object { $_.email -eq 'budi@denttech.id' }).id
$templates = Req 'GET' "$base/api/checklist-templates" $AT $null
$tplId = $templates.templates[0].id
$assign = Req 'POST' "$base/api/tickets/$($openTicket.id)/assign" $AT @{technician_id=$techId; scheduled_date=(Get-Date).ToString('yyyy-MM-dd'); time_window='13:00 - 15:00'; checklist_template_id=$tplId}
if ($assign.work_order_id) { Ok "assigned -> WO $($assign.number)"; $WO=$assign.work_order_id } else { Bad "assign failed: $($assign | ConvertTo-Json)" }

Write-Output "=== 6. TECHNICIAN FLOW ==="
$tdash = Req 'GET' "$base/api/dashboard" $TT $null
if ($tdash.stats.active -ge 1) { Ok "tech dashboard active=$($tdash.stats.active)" } else { Bad "tech dashboard" }
$woDetail = Req 'GET' "$base/api/work-orders/$WO" $TT $null
if ($woDetail.work_order.id -eq $WO) { Ok "wo detail, checklist items=$($woDetail.checklist.total_items)" } else { Bad "wo detail" }
$start = Req 'POST' "$base/api/work-orders/$WO/start" $TT $null
if ($start.ok) { Ok "wo started" } else { Bad "wo start: $($start|ConvertTo-Json)" }
# fill all checklist items PASS
$items = @()
foreach ($sec in $woDetail.checklist.sections) { foreach ($it in $sec.items) { $items += @{item_id=$it.id; result='PASS'; note='ok'} } }
$chk = Req 'POST' "$base/api/work-orders/$WO/checklist" $TT @{items=$items}
if ($chk.checklist.complete) { Ok "checklist complete" } else { Bad "checklist not complete: $($chk|ConvertTo-Json)" }
$diag = Req 'POST' "$base/api/work-orders/$WO/diagnosis" $TT @{findings='Unit bermasalah pada power supply'; root_cause='Kabel power putus'; recommendation='Ganti kabel power'}
if ($diag.ok) { Ok "diagnosis saved" } else { Bad "diagnosis" }
$wp = Req 'POST' "$base/api/work-orders/$WO/work-performed" $TT @{description='Mengganti kabel power dan kalibrasi'}
if ($wp.ok) { Ok "work performed" } else { Bad "work performed" }
# add a spare part
$parts = Req 'GET' "$base/api/parts" $AT $null
$partId = $parts.parts[0].id
$pu = Req 'POST' "$base/api/work-orders/$WO/parts" $TT @{part_id=$partId; qty=1; note='ganti part'}
if ($pu.ok) { Ok "part usage added" } else { Bad "part usage: $($pu|ConvertTo-Json)" }
# upload after photo (tiny svg data url)
$svg = '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="green"/></svg>'
$b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($svg))
$up = Req 'POST' "$base/api/files" $TT @{dataUrl="data:image/svg+xml;base64,$b64"; kind='after'; caption='Foto setelah perbaikan'; work_order_id=$WO}
if ($up.id) { Ok "after photo uploaded" } else { Bad "photo upload: $($up|ConvertTo-Json)" }
# try complete without summary -> should fail
$compBad = Req 'POST' "$base/api/work-orders/$WO/complete" $TT @{}
if ($compBad.__error -and $compBad.code -eq 400) { Ok "complete blocked without summary" } else { Bad "complete should require summary" }
$comp = Req 'POST' "$base/api/work-orders/$WO/complete" $TT @{summary='Perbaikan selesai, unit berfungsi normal'; technician_note='Perlu monitoring 1 minggu'}
if ($comp.report_number) { Ok "wo completed -> report $($comp.report_number)"; $REPORT=$comp.report_id } else { Bad "complete: $($comp|ConvertTo-Json)" }

Write-Output "=== 7. ADMIN APPROVE REPORT ==="
$approve = Req 'POST' "$base/api/service-reports/$REPORT/approve" $AT @{labor_cost=500000; due_days=14}
if ($approve.invoice_number) { Ok "report approved -> invoice $($approve.invoice_number)"; $INV=$approve.invoice_id } else { Bad "approve: $($approve|ConvertTo-Json)" }

Write-Output "=== 8. INVOICE ==="
$invDetail = Req 'GET' "$base/api/invoices/$INV" $AT $null
if ($invDetail.totals.total -gt 0) { Ok "invoice total=$($invDetail.totals.total)" } else { Bad "invoice totals" }

Write-Output "=== 9. CUSTOMER VISIBILITY ==="
$ctickets = Req 'GET' "$base/api/tickets" $CT $null
$myTicket = $ctickets.tickets | Where-Object { $_.id -eq $openTicket.id } | Select-Object -First 1
$cdetail = Req 'GET' "$base/api/tickets/$($openTicket.id)" $CT $null
if ($cdetail.ticket) { Ok "customer sees own ticket" } else { Bad "customer ticket detail" }
$internalLeak = ($cdetail.timeline | Where-Object { $_.visibility -eq 'INTERNAL' })
if (-not $internalLeak) { Ok "no INTERNAL timeline leaked to customer" } else { Bad "INTERNAL leaked!" }
# direct/manual invoice payment is admin-only
$customerPay = Req 'POST' "$base/api/invoices/$INV/pay" $CT @{method='TRANSFER'; reference='TRF-TEST-001'}
if ($customerPay.__error -and $customerPay.code -eq 403) { Ok "customer direct payment rejected 403" } else { Bad "customer direct payment should be admin-only" }
$pay = Req 'POST' "$base/api/invoices/$INV/pay" $AT @{method='TRANSFER'; reference='TRF-TEST-001'}
if ($pay.ok) { Ok "admin records invoice payment amount=$($pay.paid_amount)" } else { Bad "admin pay invoice: $($pay|ConvertTo-Json)" }

Write-Output "=== 10. ANALYTICS ==="
$an = Req 'GET' "$base/api/reports/analytics" $AT $null
if ($an.by_service_type) { Ok "analytics returned" } else { Bad "analytics" }

Write-Output ""
Write-Output "RESULT: $pass passed, $fail failed"
if ($fail -gt 0) { exit 1 }
