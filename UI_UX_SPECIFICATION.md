# UI/UX Specification — Service Management System

**Document ID:** 12_UI_UX_SPECIFICATION  
**Version:** 1.0.0  
**Status:** Baseline / Development Blueprint  
**Related Document:** `PRD.md`  
**Frontend:** HTML5 + Tailwind CSS + Vanilla JavaScript  
**Backend:** Python REST API  
**Database:** Relational Database  
**AI:** Out of Scope for MVP

---

# 1. Document Purpose

Dokumen ini mendefinisikan spesifikasi UI/UX lengkap untuk aplikasi **Service Management System**.

Aplikasi memiliki tiga portal utama:

1. Admin Portal
2. Technician Portal
3. Customer Portal

Dokumen ini menjadi acuan untuk:

- UI/UX Designer
- Frontend Developer
- Backend Developer
- QA Engineer
- Product Owner
- Project Manager

Tujuan utamanya adalah memastikan seluruh fitur memiliki:

- User flow yang jelas
- Interface yang konsisten
- Responsive design
- Role-based experience
- Validasi yang baik
- Error handling
- Loading state
- Empty state
- Accessibility
- Reusable components
- Integrasi API yang konsisten

---

# 2. Product UX Philosophy

## 2.1 Core Principle

> Make the next action obvious, make service evidence traceable, and never expose information a role is not authorized to see.

Dalam bahasa sederhana:

> Pengguna harus selalu tahu apa yang harus dilakukan berikutnya, seluruh proses service harus dapat dilacak, dan setiap user hanya boleh melihat informasi sesuai hak aksesnya.

---

# 3. UX Principles

## 3.1 Simplicity

Interface harus sederhana dan tidak membebani user dengan informasi yang tidak diperlukan.

## 3.2 Role-Oriented

Setiap portal memiliki pengalaman berbeda.

### Admin

Fokus:

- Monitoring
- Assignment
- Scheduling
- Customer management
- Equipment
- Inventory
- Reporting
- Billing

### Technician

Fokus:

- Job hari ini
- Lokasi customer
- Equipment
- Checklist
- Foto
- Diagnosis
- Repair
- Testing
- Service report
- Customer approval

### Customer

Fokus:

- Request service
- Status service
- Jadwal
- Teknisi
- Progress
- Foto pekerjaan
- Service report
- Invoice
- Service history

---

# 4. Service Lifecycle

UX harus mengikuti lifecycle service:

```text
Customer Request
       ↓
Ticket Created
       ↓
Ticket Review
       ↓
Work Order Created
       ↓
Technician Assigned
       ↓
Schedule
       ↓
Technician Arrives
       ↓
Start Service
       ↓
Before Photos
       ↓
Checklist
       ↓
Diagnosis
       ↓
Work Performed
       ↓
Spare Parts
       ↓
After Photos
       ↓
Testing
       ↓
Conclusion
       ↓
Customer Approval
       ↓
Service Report
       ↓
Invoice
       ↓
Payment
       ↓
Service History
________________________________________
5. Design System
5.1 Technology
Frontend:
HTML5
Tailwind CSS
Vanilla JavaScript
Lucide Icons
Chart.js
Backend:
Python
REST API
JSON
________________________________________
5.2 Typography
Recommended font:
Inter
Hierarchy:
Element	Size	Weight
Display	32px	700
H1	28px	700
H2	24px	700
H3	20px	600
H4	18px	600
Body	14px	400
Body Medium	14px	500
Small	12px	400
Caption	11px	400
________________________________________
5.3 Color System
Semantic colors:
Primary:
#2563EB

Success:
#16A34A

Warning:
#D97706

Danger:
#DC2626

Info:
#0891B2

Background:
#F8FAFC

Surface:
#FFFFFF

Border:
#E2E8F0

Text:
#0F172A

Muted:
#64748B
Color Usage
Primary
Digunakan untuk:
•	Main action
•	CTA
•	Active navigation
•	Links
Success
Digunakan untuk:
•	Completed
•	Paid
•	Pass
•	Approved
•	Fixed
Warning
Digunakan untuk:
•	Pending
•	Waiting
•	Near SLA
•	Low stock
Danger
Digunakan untuk:
•	Failed
•	Critical
•	Overdue
•	Error
•	Cancelled
Info
Digunakan untuk:
•	Information
•	Scheduled
•	System messages
________________________________________
5.4 Accessibility Color Rule
Status tidak boleh hanya dibedakan menggunakan warna.
Contoh:
✓ PASS
✕ FAIL
! WARNING
● IN PROGRESS
Gunakan kombinasi:
Icon + Text + Color
________________________________________
5.5 Border Radius
Small:
6px

Medium:
8px

Large:
12px

Extra Large:
16px
________________________________________
5.6 Shadow
Gunakan shadow ringan.
Card:
shadow-sm

Modal:
shadow-lg

Dropdown:
shadow-md
Jangan menggunakan shadow terlalu berat.
________________________________________
6. Layout System
6.1 Admin Layout
┌──────────────────────────────────────────────────────┐
│ HEADER                                               │
├───────────────┬──────────────────────────────────────┤
│               │ Breadcrumb                            │
│ SIDEBAR       │ Page Header                           │
│               │                                       │
│ Navigation    │ Main Content                          │
│               │                                       │
│               │                                       │
└───────────────┴──────────────────────────────────────┘
Desktop:
•	Sidebar fixed
•	Header sticky
•	Content scrollable
Mobile:
•	Sidebar menjadi drawer
________________________________________
6.2 Technician Layout
Technician menggunakan mobile-first layout.
┌──────────────────────────┐
│ HEADER                   │
├──────────────────────────┤
│                          │
│ MAIN CONTENT             │
│                          │
│                          │
├──────────────────────────┤
│ BOTTOM NAVIGATION        │
└──────────────────────────┘
Bottom navigation:
Home
Jobs
Schedule
Notifications
Profile
________________________________________
6.3 Customer Layout
Mobile:
┌──────────────────────────┐
│ HEADER                   │
├──────────────────────────┤
│ CONTENT                  │
│                          │
├──────────────────────────┤
│ HOME TICKETS EQUIPMENT   │
│ REPORTS MORE             │
└──────────────────────────┘
Desktop dapat menggunakan sidebar.
________________________________________
7. Responsive Breakpoints
Gunakan Tailwind breakpoint:
sm  = 640px
md  = 768px
lg  = 1024px
xl  = 1280px
2xl = 1536px
Target Technician:
360px
375px
390px
414px
430px
480px
Minimum touch target:
44px × 44px
________________________________________
8. Global Navigation
8.1 Admin Navigation
Dashboard

SERVICE
├── Tickets
├── Work Orders
├── Schedule
└── Service Reports

CUSTOMERS
├── Customers
├── Contacts
└── Locations

EQUIPMENT
├── Equipment
├── Categories
└── Maintenance

TECHNICIANS
├── Technicians
├── Skills
└── Availability

INVENTORY
├── Spare Parts
├── Stock
└── Transactions

BILLING
├── Invoices
└── Payments

REPORTS
├── Service
├── Technician
├── Equipment
└── Financial

NOTIFICATIONS

SETTINGS
├── Users
├── Roles & Permissions
├── Checklist Templates
├── Service Types
└── System Settings
________________________________________
8.2 Technician Navigation
Home
My Jobs
Schedule
Notifications
Profile
________________________________________
8.3 Customer Navigation
Home
Tickets
Equipment
Service History
Reports
Invoices
Notifications
Profile
________________________________________
9. Reusable Components
Komponen harus dibuat reusable.
Button
Input
Select
Textarea
DatePicker
TimePicker
Search
Filter
Modal
Drawer
Dropdown
Toast
Alert
Badge
StatusBadge
Card
Table
Pagination
Tabs
Timeline
Stepper
ProgressBar
FileUpload
ImageGallery
CameraUpload
SignaturePad
Checklist
Avatar
Skeleton
EmptyState
ErrorState
LoadingState
ConfirmationDialog
________________________________________
10. Button Specification
Variants:
Primary
Secondary
Outline
Ghost
Danger
Link
States:
Default
Hover
Active
Disabled
Loading
Contoh:
[ Create Ticket ]

[ Save Draft ]

[ Start Service ]

[ Complete Service ]

[ Cancel ]
Untuk destructive action:
[ Delete ]
harus menggunakan confirmation dialog.
________________________________________
11. Form Specification
Setiap form harus memiliki:
Label
Input
Helper Text
Validation
Error Message
Required Indicator
Contoh:
Serial Number *

[_____________________]

Enter the equipment serial number.

Serial number is required.
________________________________________
12. Form Validation
Validasi harus terjadi:
1.	Client side
2.	Backend side
Client side memberikan UX cepat.
Backend tetap menjadi authority.
________________________________________
13. Loading State
Gunakan skeleton.
Contoh:
┌────────────────────────────┐
│ █████████████              │
│ ██████████                 │
│ █████████████████          │
└────────────────────────────┘
Untuk action:
[ Saving... ]
Button harus disabled selama request berlangsung untuk mencegah double submit.
________________________________________
14. Empty State
Contoh Ticket:
No service requests yet.

Request a service when you need help
with your equipment.

[ Request Service ]
Empty state harus memberikan next action.
________________________________________
15. Error State
Something went wrong.

We couldn't load the service information.

[ Try Again ]
Jangan menampilkan stack trace kepada user.
________________________________________
16. Toast Notification
Contoh:
✓ Ticket created successfully.
✓ Service report saved.
! Unable to upload photo.
Toast:
•	Tidak menghalangi workflow
•	Auto dismiss
•	Bisa ditutup manual
•	Tidak digunakan untuk error kritis yang membutuhkan tindakan
________________________________________
17. ADMIN PORTAL
17.1 Admin Dashboard
Dashboard harus menjawab:
Apa yang sedang terjadi di perusahaan sekarang?
KPI:
New Tickets
Open Tickets
In Progress
Overdue
Today's Jobs
Completed
Pending Approval
Outstanding Invoice
________________________________________
17.2 Dashboard Layout
┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
│ Tickets  │ │ Progress │ │ Overdue  │ │ Invoice  │
│ 24       │ │ 18       │ │ 3        │ │ Rp ...   │
└──────────┘ └──────────┘ └──────────┘ └──────────┘

┌─────────────────────────────┐
│ Service Activity             │
│                             │
│       Chart                 │
│                             │
└─────────────────────────────┘

┌─────────────────┐ ┌────────────────────┐
│ Today's Jobs    │ │ Attention Required │
└─────────────────┘ └────────────────────┘
________________________________________
17.3 Ticket List
Columns:
Ticket #
Customer
Equipment
Priority
Status
Created
Assigned Technician
Schedule
SLA
Action
Filters:
Status
Priority
Customer
Technician
Equipment
Date
SLA
Actions:
View
Edit
Assign
Schedule
Create Work Order
Cancel
________________________________________
17.4 Ticket Detail
Header:
TKT-2026-000123

[ HIGH ]
[ IN PROGRESS ]

Customer Name
Equipment Name

[ Assign ]
[ Schedule ]
[ Create Work Order ]
Tabs:
Overview
Timeline
Work Orders
Attachments
Comments
Invoice
________________________________________
17.5 Create Ticket
Gunakan wizard.
1 Customer
2 Location
3 Equipment
4 Problem
5 Priority
6 Schedule
7 Attachments
8 Confirmation
Progress:
●────●────●────○────○
________________________________________
17.6 Work Order
Work Order Detail:
WO Number
Ticket Number
Customer
Location
Equipment
Technician
Schedule
Priority
Status
Tabs:
Overview
Checklist
Diagnosis
Work
Parts
Photos
Testing
Report
Timeline
________________________________________
17.7 Schedule
Calendar:
Day
Week
Month
Schedule card:
10:00 - 12:00

Budi
ABC Company

Equipment:
AC-001

Priority:
High
Warning:
Technician schedule conflict.
________________________________________
17.8 Customer Management
Customer List:
Customer
PIC
Location
Active Equipment
Open Tickets
Status
Customer Detail:
Overview
Contacts
Locations
Equipment
Tickets
Work Orders
Service History
Invoices
Documents
________________________________________
17.9 Equipment Management
Equipment list:
Asset #
Equipment
Brand
Model
Serial Number
Customer
Warranty
Status
Last Service
Equipment Detail:
Overview
Service History
Maintenance
Documents
Photos
Tickets
________________________________________
17.10 Technician Management
Technician profile:
Name
Photo
Status
Skills
Certifications
Availability
Current Jobs
Performance
Performance:
Completed Jobs
Average Resolution Time
First-Time Fix Rate
SLA Compliance
Customer Rating
________________________________________
17.11 Inventory
Spare Part list:
Part Code
Part Name
Category
Current Stock
Reserved
Available
Minimum Stock
Unit
Status
Status:
IN STOCK
LOW STOCK
OUT OF STOCK
________________________________________
17.12 Invoice
Invoice detail:
Invoice Number
Customer
Service
Date
Due Date

Labor
Parts
Travel
Other
Discount
Tax

TOTAL

Payment Status
Actions:
Download PDF
Send to Customer
Record Payment
Cancel
________________________________________
18. TECHNICIAN PORTAL
18.1 Technician UX Principle
Technician portal harus:
•	Cepat
•	Mobile-first
•	Minim typing
•	Camera friendly
•	Offline-tolerant jika memungkinkan
•	Step-by-step
•	Tidak membuat technician mengulang data
________________________________________
18.2 Technician Home
Prioritas:
Critical Jobs
Today's Jobs
Overdue Jobs
Upcoming Jobs
Job Card:
┌─────────────────────────────┐
│ HIGH                        │
│                             │
│ 10:00 - 12:00               │
│ ABC Company                 │
│                             │
│ Equipment #001              │
│ Jakarta                     │
│                             │
│ [ Open Job ]                │
└─────────────────────────────┘
________________________________________
18.3 My Jobs
Filter:
Today
Tomorrow
This Week
Overdue
Completed
________________________________________
18.4 Job Detail
WO-2026-000123

ABC Company

Equipment #001

10:00 - 12:00

[ Start Service ]
Informasi:
Customer
Location
PIC
Equipment
Complaint
Previous Service
Special Instructions
________________________________________
18.5 Start Service
Saat technician menekan:
[ Start Service ]
sistem:
record started_at
record technician
record location jika diaktifkan
change status = IN_PROGRESS
create timeline event
UX:
Service started at 10:04 AM.
________________________________________
18.6 Service Stepper
1 Overview
2 Before Photos
3 Checklist
4 Diagnosis
5 Work Performed
6 Spare Parts
7 After Photos
8 Testing
9 Conclusion
10 Customer Approval
Progress:
████████░░ 80%
User dapat kembali ke step sebelumnya tanpa kehilangan data.
________________________________________
19. BEFORE PHOTO
Before photo digunakan sebagai bukti kondisi awal.
Kategori:
Equipment
Serial Number
Problem
General Condition
UI:
Before Service

[ 📷 Take Photo ]

or

[ Upload From Gallery ]
Setelah upload:
┌────────┐
│ PHOTO  │
│        │
└────────┘

[ Retake ]
[ Delete ]
Metadata:
uploaded_at
uploaded_by
work_order_id
category
visibility
________________________________________
20. CHECKLIST UX
Checklist adalah salah satu komponen terpenting aplikasi.
Checklist harus dynamic.
Tidak boleh hard-coded di frontend.
________________________________________
20.1 Checklist Structure
Checklist Template
│
├── Section
│   ├── Item
│   ├── Item
│   └── Item
│
├── Section
│   ├── Item
│   └── Item
│
└── Section
    ├── Item
    └── Item
________________________________________
20.2 Checklist Item
Setiap item dapat memiliki:
Label
Description
Result Type
Required
Expected Value
Unit
Minimum
Maximum
N/A Allowed
Note Required
Photo Required
________________________________________
20.3 Supported Checklist Types
PASS / FAIL

YES / NO

NORMAL / ABNORMAL

NUMERIC

TEXT

SINGLE SELECT

MULTI SELECT

CHECKBOX

MEASUREMENT

PHOTO

SIGNATURE
________________________________________
20.4 Example Checklist
ELECTRICAL INSPECTION

Power Cable
[ PASS ] [ FAIL ] [ N/A ]

Power Connector
[ PASS ] [ FAIL ] [ N/A ]

Input Voltage

Expected:
220V ±10%

Actual:
[ 221 ] V

Result:
✓ PASS

Notes:
[________________________]
________________________________________
20.5 Failed Checklist Rule
Jika:
Result = FAIL
sistem dapat mewajibkan:
Note
Photo
Diagnosis
Corrective Action
sesuai konfigurasi template.
________________________________________
20.6 Checklist Progress
Checklist Progress

18 / 24 completed

███████████████░░░░░
75%
________________________________________
20.7 Checklist Validation
Jika ada item required:
Cannot complete service.

6 required checklist items are incomplete.

[ Review Items ]
Klik akan membawa user ke item yang belum selesai.
________________________________________
21. DIAGNOSIS
Form:
Complaint Verified
[ Yes ] [ No ]

Finding
[____________________________]

Root Cause
[____________________________]

Severity
[ Low ] [ Medium ] [ High ] [ Critical ]

Recommendation
[____________________________]
Jika root cause belum diketahui:
Root Cause:
Unknown / Requires Further Inspection
________________________________________
22. WORK PERFORMED
Quick action:
☐ Inspection
☐ Cleaning
☐ Adjustment
☐ Repair
☐ Replacement
☐ Calibration
☐ Testing
☐ Installation
☐ Preventive Maintenance
☐ Other
Detail:
Work Description

[________________________________]
[________________________________]
[________________________________]
________________________________________
23. SPARE PARTS
Part search:
[ Search spare part... ]
Part card:
Bearing 6204

Available:
25

Quantity:
[ 1 ]

[ Add ]
Added part:
Bearing 6204
Qty: 1

[ Edit ] [ Remove ]
Backend harus melakukan validasi stock.
Frontend tidak boleh menjadi authority stock.
________________________________________
24. AFTER PHOTO
After photos menjadi bukti hasil pekerjaan.
Kategori:
Completed Work
Repaired Area
Replaced Part
Final Condition
Testing Result
Customer-visible photo dapat ditentukan:
Visibility

○ Internal
● Customer Visible
________________________________________
25. TESTING
Testing harus mendukung measurement.
Contoh:
FINAL TESTING

Power Test

Expected:
ON

Actual:
ON

Result:
PASS
Measurement:
Voltage

Expected:
220V ±10%

Actual:
220V

Unit:
V

Result:
PASS
________________________________________
26. SERVICE CONCLUSION
Form:
Service Result

[ FIXED ▼ ]
Options:
FIXED
FIXED_WITH_RECOMMENDATION
TEMPORARILY_FIXED
NOT_FIXED
WAITING_FOR_PART
WAITING_FOR_CUSTOMER
NO_FAULT_FOUND
Fields:
Final Condition

Remaining Issue

Recommendation

Follow-up Required

Next Maintenance Date
________________________________________
27. CUSTOMER APPROVAL
Customer approval dilakukan setelah pekerjaan selesai.
Display:
SERVICE COMPLETED

Customer:
ABC Company

Equipment:
Equipment #001

Result:
FIXED
Customer:
Name
[____________________]

Signature

┌─────────────────────┐
│                     │
│    SIGN HERE        │
│                     │
└─────────────────────┘

☐ I confirm that the service has been completed.

[ Confirm Service ]
________________________________________
28. SERVICE COMPLETION VALIDATION
Sebelum technician dapat menyelesaikan Work Order:
✓ Before Photos
✓ Checklist
✓ Diagnosis
✓ Work Performed
✓ Parts
✓ After Photos
✓ Testing
✓ Conclusion
✓ Customer Approval
Jika ada yang belum:
Service cannot be completed.

Missing:

• After Photos
• Testing Result
Button:
[ Review Missing Items ]
________________________________________
29. CUSTOMER PORTAL
29.1 Customer UX Principle
Customer portal harus memberikan:
Visibility
Transparency
Trust
Evidence
Simple Communication
Customer tidak perlu memahami struktur internal sistem.
________________________________________
29.2 Customer Dashboard
Hello, ABC Company

┌──────────────┐
│ Open Tickets │
│ 3            │
└──────────────┘

┌──────────────┐
│ Active Jobs  │
│ 1            │
└──────────────┘

┌──────────────┐
│ Equipment    │
│ 12           │
└──────────────┘
Active Service:
TKT-2026-000123

Equipment #001

IN PROGRESS

████████░░

Technician:
Budi

[ View Service ]
CTA:
[ + Request Service ]
________________________________________
30. CUSTOMER TICKET
Ticket Card:
TKT-2026-000123

Equipment #001

Priority:
HIGH

Status:
IN PROGRESS

Schedule:
28 Aug 2026
10:00 - 12:00

[ View ]
________________________________________
31. CUSTOMER TICKET DETAIL
Customer dapat melihat:
Ticket Number
Problem
Equipment
Schedule
Status
Timeline
Technician
Customer-visible photos
Customer-visible notes
Service Report
Invoice
Customer tidak dapat melihat:
Internal Notes
Internal Cost
Margin
Internal Attachments
Internal Technician Notes
Other Customers
________________________________________
32. CUSTOMER SERVICE TIMELINE
● Service Completed
  28 Aug 14:30

● Testing Completed
  28 Aug 13:30

● Technician Started Service
  28 Aug 11:00

● Technician Assigned
  27 Aug 16:00

● Service Request Created
  27 Aug 15:20
Timeline disaring berdasarkan visibility.
________________________________________
33. CUSTOMER EQUIPMENT
Equipment card:
Equipment #001

Brand:
ABC

Model:
XYZ-100

Serial Number:
SN123456

Warranty:
VALID

Last Service:
20 Aug 2026

[ View Equipment ]
________________________________________
34. EQUIPMENT SERVICE HISTORY
28 Aug 2026
Repair
Result: Fixed

20 Aug 2026
Maintenance
Result: Completed

15 Jun 2026
Repair
Result: Fixed
Filter:
Date
Service Type
Equipment
Result
________________________________________
35. CUSTOMER SERVICE REPORT
Report harus mudah dibaca.
Struktur:
SERVICE REPORT

Customer

Equipment

Service Date

Technician

Problem

Inspection

Diagnosis

Work Performed

Parts Used

Testing

Before Photos

After Photos

Conclusion

Customer Approval
Action:
[ Download PDF ]
________________________________________
36. CUSTOMER INVOICE
INVOICE #INV-2026-00123

Service:
WO-2026-000123

Subtotal
Rp ...

Discount
Rp ...

Tax
Rp ...

TOTAL
Rp ...

Status:
UNPAID

Due Date:
10 Sep 2026
Actions:
[ Download PDF ]

[ Pay Now ]
Payment gateway dapat menjadi fitur fase berikutnya.
________________________________________
37. CUSTOMER PROFILE
Company Information
Contacts
Locations
Users
Notification Preferences
Security
________________________________________
38. STATUS SYSTEM
38.1 Ticket Status
NEW
UNDER_REVIEW
WAITING_FOR_CUSTOMER
SCHEDULED
ASSIGNED
IN_PROGRESS
WAITING_FOR_PART
WAITING_FOR_APPROVAL
COMPLETED
CLOSED
CANCELLED
________________________________________
38.2 Work Order Status
DRAFT
ASSIGNED
SCHEDULED
EN_ROUTE
ARRIVED
IN_PROGRESS
WAITING_FOR_PART
WAITING_FOR_CUSTOMER
COMPLETED
CLOSED
CANCELLED
________________________________________
38.3 Priority
LOW
NORMAL
HIGH
CRITICAL
________________________________________
38.4 Payment Status
DRAFT
ISSUED
UNPAID
PARTIAL
PAID
OVERDUE
CANCELLED
________________________________________
39. TIMELINE COMPONENT
Timeline adalah reusable component.
● 14:30
  Service Completed

● 13:50
  Customer Approved

● 13:30
  Final Testing Completed

● 11:00
  Technician Started

● 09:30
  Technician Assigned

● 08:00
  Work Order Created
Event:
event_id
event_type
timestamp
user
role
description
visibility
________________________________________
40. PHOTO UX
Photo categories:
BEFORE_SERVICE
EQUIPMENT_ID
PROBLEM
INSPECTION
REPAIR
REPLACED_PART
MEASUREMENT
AFTER_SERVICE
OTHER
Visibility:
INTERNAL
CUSTOMER_VISIBLE
Metadata:
File ID
Filename
Storage Path
MIME Type
Size
Uploaded By
Uploaded At
Work Order
Category
Caption
Visibility
________________________________________
41. Photo Upload UX
Flow:
[ Add Photo ]
      ↓
Camera / Gallery
      ↓
Preview
      ↓
Category
      ↓
Caption
      ↓
Visibility
      ↓
Upload
      ↓
Success
Upload progress:
Uploading...

████████████░░░
85%
Jika gagal:
Upload failed.

[ Retry ]
________________________________________
42. Image Gallery
Desktop:
┌────────┐ ┌────────┐ ┌────────┐
│ PHOTO  │ │ PHOTO  │ │ PHOTO  │
└────────┘ └────────┘ └────────┘
Mobile:
┌──────┐ ┌──────┐
│ IMG  │ │ IMG  │
└──────┘ └──────┘
Klik membuka full-screen viewer.
________________________________________
43. SERVICE REPORT UX
Service Report tidak boleh meminta technician mengisi ulang data yang sudah ada.
Data diambil dari:
Ticket
Equipment
Customer
Work Order
Checklist
Diagnosis
Work
Parts
Photos
Testing
Conclusion
Approval
________________________________________
44. Report Generation
Flow:
Work Order Completed
        ↓
Validate Data
        ↓
Generate Report
        ↓
Preview
        ↓
Approval
        ↓
PDF
Report harus memiliki nomor unik.
________________________________________
45. SEARCH
Search mendukung:
Ticket Number
Work Order Number
Customer
Serial Number
Asset Number
Invoice Number
Part Number
Global search:
[ Search... ]
Results dikelompokkan:
Tickets
Equipment
Customers
Work Orders
Invoices
________________________________________
46. FILTER UX
Filter drawer:
Status
[ All ]

Priority
[ All ]

Customer
[ All ]

Technician
[ All ]

Date
[ From ] [ To ]

[ Apply Filters ]

[ Reset ]
Mobile menggunakan drawer.
Desktop dapat menggunakan inline filter.
________________________________________
47. NOTIFICATION SYSTEM
Notification types:
New Ticket
Ticket Assigned
Work Order Assigned
Schedule Changed
Technician Started
Service Completed
Customer Approved
Invoice Issued
Invoice Overdue
SLA Warning
SLA Breach
Notification card:
● Work Order Assigned

WO-2026-000123
ABC Company

10 minutes ago
________________________________________
48. SECURITY UX
User hanya dapat melihat data sesuai role.
Admin
Dapat melihat seluruh data sesuai permission.
Technician
Hanya dapat melihat:
Assigned Jobs
Authorized Customer Data
Required Equipment Data
Required Service History
Customer
Hanya dapat melihat:
Own Company
Own Locations
Own Equipment
Own Tickets
Own Reports
Own Invoices
Customer-visible Photos
Customer-visible Timeline
________________________________________
49. Permission UX
Jika user tidak memiliki permission:
You don't have permission
to perform this action.
Button dapat:
•	Hidden
•	Disabled
•	Visible dengan tooltip
Tergantung security requirement.
Backend tetap harus melakukan authorization.
________________________________________
50. Session Expiry
Your session has expired.

Please sign in again.

[ Sign In ]
Data draft sebaiknya tidak hilang.
________________________________________
51. Responsive UX
Desktop
Optimalkan:
Tables
Charts
Multi-column forms
Side-by-side details
Tablet
Optimalkan:
2-column layouts
Collapsible navigation
Responsive tables
Mobile
Optimalkan:
Cards
Bottom navigation
Large buttons
Single-column forms
Camera
Swipe/tap actions
________________________________________
52. Technician Mobile Rules
Prioritas:
Camera
Checklist
Quick Actions
Numeric Input
Dropdown
Checkbox
Radio
Kurangi:
Long textarea
Typing panjang
Multiple modal
Complex table
________________________________________
53. Offline / Poor Connection UX
Jika memungkinkan pada fase implementasi:
Online
Offline
Syncing
Sync Failed
Banner:
You're offline.

Changes will sync when connection is restored.
Draft service harus dapat disimpan lokal jika fitur offline diimplementasikan.
________________________________________
54. Performance UX
Frontend harus:
•	Lazy load image
•	Compress photo
•	Pagination
•	Debounce search
•	Lazy load gallery
•	Upload progress
•	Retry upload
•	Avoid loading unnecessary records
•	Cache static assets
________________________________________
55. API Interaction UX
Contoh:
GET /api/tickets
Loading:
Loading tickets...
Success:
Render ticket list
Error:
Unable to load tickets.

[ Retry ]
________________________________________
56. Frontend Architecture
Recommended:
frontend/
│
├── index.html
│
├── admin/
│   ├── dashboard/
│   ├── tickets/
│   ├── work-orders/
│   ├── customers/
│   ├── equipment/
│   ├── technicians/
│   ├── inventory/
│   ├── invoices/
│   ├── reports/
│   └── settings/
│
├── technician/
│   ├── home/
│   ├── jobs/
│   ├── schedule/
│   ├── service/
│   └── profile/
│
├── customer/
│   ├── home/
│   ├── tickets/
│   ├── equipment/
│   ├── history/
│   ├── reports/
│   ├── invoices/
│   └── profile/
│
├── components/
│   ├── button.js
│   ├── modal.js
│   ├── table.js
│   ├── badge.js
│   ├── timeline.js
│   ├── checklist.js
│   └── gallery.js
│
├── services/
│   ├── api.js
│   ├── auth.js
│   ├── tickets.js
│   ├── work-orders.js
│   ├── equipment.js
│   └── uploads.js
│
├── utils/
│   ├── validation.js
│   ├── formatter.js
│   ├── date.js
│   └── permissions.js
│
├── assets/
│
└── styles/
________________________________________
57. Component Architecture
Component harus menerima data.
Contoh konsep:
<StatusBadge status="IN_PROGRESS" />
Bukan:
<div class="blue">
    In Progress
</div>
Business logic tidak boleh ditanam di visual component.
________________________________________
58. State Management
Untuk MVP tanpa framework frontend:
Page State
Component State
Session State
Draft State
Gunakan JavaScript module.
Contoh:
state/
services/
components/
pages/
Untuk aplikasi yang semakin besar, arsitektur state dapat dikembangkan tanpa harus mengganti HTML/Tailwind/Vanilla JS.
________________________________________
59. Data Boundary
Frontend tidak boleh menjadi source of truth untuk:
Permission
Ticket Status
Work Order Status
Invoice Total
Stock
Payment
Checklist Completion Authority
Backend Python menjadi source of truth.
________________________________________
60. Auto Save
Untuk form service technician:
Auto-save Draft
Indicator:
Saving...
kemudian:
Saved 10:32 AM
Jika gagal:
Unable to save.

Retrying...
________________________________________
61. Form Unsaved Changes
Jika user keluar:
You have unsaved changes.

Are you sure you want to leave?

[ Stay ]
[ Leave ]
________________________________________
62. Confirmation Dialog
Untuk action destructive:
Delete Ticket?

This action cannot be undone.

[ Cancel ]
[ Delete ]
Untuk completion:
Complete Service?

Make sure all required checklist items,
photos and testing results are complete.

[ Cancel ]
[ Complete Service ]
________________________________________
63. Accessibility
Target:
WCAG 2.1 AA where practical
Requirement:
•	Semantic HTML
•	Keyboard navigation
•	Focus state
•	Accessible labels
•	ARIA jika diperlukan
•	Alt text
•	Contrast
•	Screen reader support
•	Error messages
•	Focus management
•	Touch target minimum 44px
________________________________________
64. Accessibility Example
Bad:
<button>
    X
</button>
Good:
<button aria-label="Close dialog">
    X
</button>
________________________________________
65. Localization
UI sebaiknya siap untuk:
Bahasa Indonesia
English
Tanggal:
DD MMM YYYY
Contoh:
28 Aug 2026
Currency:
Rp 2.500.000
Timezone default mengikuti konfigurasi perusahaan/user.
________________________________________
66. Date & Time UX
Gunakan:
Date Picker
Time Picker
Date Range Picker
Calendar
Jangan mengandalkan input text manual untuk seluruh workflow.
________________________________________
67. Dashboard Analytics UX
Chart:
Tickets Created
Tickets Completed
Average Resolution Time
SLA Compliance
Technician Performance
Equipment Failure
Chart harus dapat difilter:
Today
7 Days
30 Days
90 Days
Custom
________________________________________
68. Admin Bulk Actions
Jika diperlukan:
☐ Ticket A
☐ Ticket B
☐ Ticket C
Bulk actions:
Assign Technician
Change Priority
Change Status
Export
Bulk destructive action harus memiliki confirmation.
________________________________________
69. Customer Request Service UX
Customer flow:
Request Service
       ↓
Select Equipment
       ↓
Describe Problem
       ↓
Priority
       ↓
Preferred Schedule
       ↓
Upload Photos
       ↓
Review
       ↓
Submit
________________________________________
70. Customer Request Form
Equipment *
[ Select Equipment ]

Problem *
[________________________]

Description
[________________________]

Preferred Date
[ Select Date ]

Preferred Time
[ Select Time ]

Photos
[ Upload ]

[ Submit Request ]
________________________________________
71. Customer Communication
Customer dapat mengirim:
Comment
Attachment
Additional Information
Admin/technician dapat membalas sesuai permission.
Internal communication tetap terpisah dari customer communication.
________________________________________
72. Service Evidence Model
Bukti service terdiri dari:
Before Photo
Checklist
Measurement
Diagnosis
Work Performed
Spare Parts
After Photo
Testing
Customer Approval
UX harus membuat evidence mudah ditelusuri dari Work Order.
________________________________________
73. Customer Visibility Rules
Setiap evidence memiliki:
INTERNAL
CUSTOMER_VISIBLE
Contoh:
Internal technician note
→ INTERNAL

Service completion photo
→ CUSTOMER_VISIBLE
Default visibility harus ditentukan oleh backend/template.
________________________________________
74. Checklist Template Management
Admin dapat membuat:
Checklist Template
Fields:
Template Name
Service Type
Equipment Type
Version
Status
Sections:
Electrical
Mechanical
Safety
Cleaning
Testing
Final Inspection
________________________________________
75. Checklist Versioning
Contoh:
AC Maintenance Template
Version 1.0
Version 1.1
Version 2.0
Jika Work Order menggunakan version 1.0:
Service record harus tetap menggunakan version 1.0 walaupun template sudah diperbarui.
________________________________________
76. Service Report Versioning
Service report harus memiliki:
Report Number
Report Version
Generated At
Generated By
Approved At
Approved By
Jika report direvisi:
Version 1
Version 2
Historical record tetap tersedia sesuai policy.
________________________________________
77. UX Audit Checklist
Setiap halaman harus diperiksa:
[ ] Loading state
[ ] Empty state
[ ] Error state
[ ] Permission state
[ ] Validation
[ ] Success feedback
[ ] Mobile
[ ] Tablet
[ ] Desktop
[ ] Accessibility
[ ] Keyboard navigation
[ ] API failure
[ ] Slow network
[ ] Large data
________________________________________
78. UI/UX Definition of Done
Sebuah fitur dianggap selesai apabila:
✓ UI selesai
✓ Responsive
✓ Loading state
✓ Empty state
✓ Error state
✓ Validation
✓ Permission
✓ API integration
✓ Real data
✓ Success feedback
✓ Accessibility
✓ Security behavior
✓ QA passed
________________________________________
79. Recommended Development Order
Phase 1 — Foundation
Design System
Reusable Components
Authentication
Role System
Layout
Navigation
Phase 2 — Master Data
Customers
Locations
Equipment
Technicians
Service Types
Spare Parts
Phase 3 — Service Core
Tickets
Work Orders
Assignment
Schedule
Status
Timeline
Phase 4 — Technician Workflow
Start Service
Before Photos
Checklist
Diagnosis
Work
Parts
After Photos
Testing
Conclusion
Phase 5 — Customer Experience
Customer Portal
Ticket Tracking
Timeline
Photos
Service Report
Approval
Phase 6 — Billing
Invoice
Payment
Payment Status
Phase 7 — Reporting
Dashboard
Service Reports
Technician Reports
Equipment Reports
Financial Reports
________________________________________
80. Future Enhancement
AI tidak termasuk MVP.
AI dapat ditambahkan pada fase berikutnya untuk:
Service Report Summarization
Technician Report Assistance
Failure Pattern Analysis
Maintenance Recommendation
Equipment Risk Prediction
Automatic Diagnosis Assistance
Customer Report Summary
AI harus menjadi layer tambahan dan tidak merusak workflow utama.
________________________________________
81. Final UX Architecture
                    SERVICE MANAGEMENT SYSTEM
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
       ADMIN              TECHNICIAN           CUSTOMER
          │                   │                   │
    Management            Field Work         Transparency
          │                   │                   │
          └───────────────────┼───────────────────┘
                              │
                              ▼
                         SERVICE DATA
                              │
          ┌───────────────────┼───────────────────┐
          │                   │                   │
          ▼                   ▼                   ▼
       Customer           Equipment             Ticket
                              │                   │
                              └─────────┬─────────┘
                                        ▼
                                   Work Order
                                        │
                                        ▼
                                    Checklist
                                        │
                        ┌───────────────┼───────────────┐
                        │               │               │
                        ▼               ▼               ▼
                     Photos           Parts          Testing
                        │               │               │
                        └───────────────┼───────────────┘
                                        ▼
                                  Service Report
                                        │
                                        ▼
                                Customer Approval
                                        │
                                        ▼
                                     Invoice
                                        │
                                        ▼
                                  Service History
________________________________________
82. Final Design Direction
Admin Portal
Style:
Professional
Data Dense
SaaS / ERP Style
Desktop Optimized
Prioritas:
Monitoring
Operations
Assignment
Scheduling
Reporting
________________________________________
Technician Portal
Style:
Mobile First
Action Oriented
Large Touch Target
Camera Friendly
Minimal Typing
Step Based
Prioritas:
Jobs
Checklist
Photos
Diagnosis
Repair
Testing
Completion
________________________________________
Customer Portal
Style:
Clean
Simple
Trustworthy
Transparent
Mobile Friendly
Prioritas:
Request
Track
Evidence
Report
Approval
Invoice
History
________________________________________
83. Core UX Rules
Rule 1:
Jangan meminta user mengisi data yang sudah tersedia.
Rule 2:
Technician harus dapat menyelesaikan service dari HP.
Rule 3:
Customer harus dapat melihat progress tanpa perlu menghubungi admin.
Rule 4:
Semua evidence service harus dapat ditelusuri ke Work Order.
Rule 5:
Internal information tidak boleh bocor ke Customer Portal.
Rule 6:
Backend adalah source of truth.
Rule 7:
Checklist harus dynamic dan versioned.
Rule 8:
Foto before/after harus menjadi bagian dari service evidence.
Rule 9:
Service report harus terbentuk dari data service, bukan ditulis ulang manual.
Rule 10:
Setiap halaman harus memiliki loading, empty, error, dan validation state.
________________________________________
84. Recommended Next Documents
Setelah dokumen UI/UX ini, dokumentasi teknis berikutnya direkomendasikan:
01_SRS.md
02_BUSINESS_PROCESS.md
03_ROLE_PERMISSION_MATRIX.md
04_USER_FLOW.md
05_DATABASE_DESIGN.md
06_API_SPECIFICATION.md
07_AUTHENTICATION_AUTHORIZATION.md
08_NOTIFICATION_SPECIFICATION.md
09_FILE_STORAGE_SPECIFICATION.md
10_CHECKLIST_LIBRARY.md
11_SERVICE_REPORT_SPECIFICATION.md
12_UI_UX_SPECIFICATION.md
13_DEPLOYMENT.md
14_TESTING_QA.md
15_SECURITY_SPECIFICATION.md
16_DEVELOPMENT_ROADMAP.md
________________________________________
85. Document Status
Document:
12_UI_UX_SPECIFICATION.md

Version:
1.0.0

Status:
Baseline Specification

Frontend:
HTML5 + Tailwind CSS + Vanilla JavaScript

Backend:
Python REST API

Portals:
Admin
Technician
Customer

AI:
Not included in MVP
________________________________________
END OF DOCUMENT