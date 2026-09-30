# KaryaLink — Frontend Redesign & Continuation Prompt

## ROLE

You are an **Expert Frontend Engineer, SaaS Product Designer, UI/UX Designer, and Design-System Architect**.

You are continuing an existing frontend development task for **KaryaLink**.

The goal is to continue the implementation from exactly where the previous task stopped, then redesign and polish the frontend into a **premium, modern, professional infrastructure/project-management SaaS platform** inspired by the attached design references.

---

# 1. FIRST: CONTINUE THE EXISTING TASK

The previous frontend implementation stopped because of the usage/credit limit.

**DO NOT restart the project from scratch.**

Before making changes:

1. Inspect the entire existing codebase.
2. Understand what has already been implemented.
3. Identify what the previous task completed.
4. Identify what remains unfinished.
5. Check existing routes/pages/components.
6. Check existing functionality and interactions.
7. Check the current data flow and API integration.
8. Check the existing responsive behavior.
9. Check the current styling/design system.
10. Continue from the existing implementation rather than rebuilding completed work.

### Critical rule

**Preserve all working functionality.**

Do not remove, replace, or break existing features simply to achieve the new visual design.

If an existing component already works correctly, improve its visual presentation rather than unnecessarily rewriting its logic.

---

# 2. CHANGE THE PRODUCT NAME TO KARYALINK

The entire application should consistently use:

# KaryaLink

### Product descriptor

**Site-to-Schedule Intelligence**

Replace old/temporary product names wherever they appear.

Check and update:

* Browser title
* Navbar/logo
* Sidebar
* Dashboard
* Login/authentication screens
* Page headings
* Empty states
* Loading states
* Error pages
* Notifications
* Modals
* Tooltips
* Footer
* Metadata
* Favicon/title references where applicable
* Any hardcoded project/product name

Do not leave inconsistent old branding anywhere in the UI.

---

# 3. IMPORTANT — REFERENCE FOLDER

There is a dedicated folder named:

```text
references/
```

Inside this folder there will be:

```text
references/
├── Design Reference.mp4
├── Frontend_Design_Reference_Dark.webp
└── frontend.md
```

The files have different purposes:

### `Design Reference.mp4`

This is a visual/video reference.

Study it carefully for:

* Layout behavior
* Animation
* Transitions
* Dashboard interactions
* Component behavior
* Spacing
* Navigation
* Visual hierarchy
* Motion
* Card interactions
* Responsive behavior

Do not blindly copy it.

Use it as a **design inspiration/reference**.

---

### `Frontend_Design_Reference_Dark.webp`

This is the primary visual reference for the redesign.

Use it to understand:

* Dark theme
* Dashboard structure
* Sidebar
* Top navigation
* Cards
* Typography
* Border treatment
* Charts
* Metric presentation
* Buttons
* Pills
* Status indicators
* Spacing
* Rounded corners
* Visual hierarchy
* Overall premium SaaS aesthetic

The goal is to achieve a **similar level of visual polish and sophistication**, while designing a completely original KaryaLink interface.

---

### `frontend.md`

This file contains the instructions you are currently reading.

Follow it as the frontend implementation specification.

---

# 4. DESIGN DIRECTION

Redesign KaryaLink as a:

> **Premium dark-mode infrastructure project intelligence platform**

The visual quality should feel comparable to a modern enterprise SaaS dashboard.

Think:

* Premium SaaS
* Enterprise dashboard
* Data intelligence platform
* Modern project-control software
* AI-powered operations platform
* High-end developer/product design

Avoid making it look like:

* A generic admin dashboard
* A basic Bootstrap dashboard
* A university project
* A template website
* A crypto dashboard
* A generic AI chatbot
* A collection of unrelated cards

The reference uses a sophisticated dark dashboard aesthetic.

**Translate that visual language into KaryaLink's infrastructure/project-management domain.**

---

# 5. DO NOT COPY THE REFERENCE LITERALLY

The reference is for **visual inspiration**, not duplication.

Do NOT copy:

* Crypto terminology
* Crypto assets
* Staking concepts
* Wallet UI
* Cryptocurrency graphs
* Exact text
* Exact branding
* Exact layout dimensions
* Exact illustrations
* Exact component arrangement

Instead, translate the same design principles into KaryaLink.

For example:

### Reference concept

```text
Asset Cards
```

### KaryaLink equivalent

```text
Active Projects
```

---

### Reference concept

```text
Reward Rate
```

### KaryaLink equivalent

```text
Progress
```

---

### Reference concept

```text
Investment Period
```

### KaryaLink equivalent

```text
Project Timeline
```

---

### Reference concept

```text
Asset Performance
```

### KaryaLink equivalent

```text
Planned vs Actual Progress
```

---

### Reference concept

```text
Portfolio
```

### KaryaLink equivalent

```text
Project Portfolio
```

The result must clearly feel like **KaryaLink**, not a reskinned crypto website.

---

# 6. CORE KARYALINK VISUAL IDENTITY

Use a sophisticated dark interface.

### Primary background

Very dark navy/black.

Use subtle variations between:

* Application background
* Sidebar
* Cards
* Elevated panels
* Modals

Avoid making the entire application one flat black color.

---

# 7. COLOR SYSTEM

Use a restrained professional palette.

### Base

* Near-black / deep navy background
* Slightly lighter card surfaces
* Subtle borders

### Accent

Use a refined blue/violet accent system similar in visual intensity to the reference.

Accent colors may be used for:

* Primary actions
* Active navigation
* AI-related elements
* Important metrics
* Progress indicators
* Charts
* Focus states

### Status colors

Use semantic colors:

* Green → healthy / completed / on track
* Amber → warning / pending / review required
* Red → critical / delayed / exception
* Blue → information / active
* Violet → AI/intelligence-related actions

Do not use excessive saturated colors.

The interface should remain professional.

---

# 8. TYPOGRAPHY

Use a modern clean sans-serif typeface.

Prioritize:

* Excellent readability
* Strong hierarchy
* Large metric typography
* Compact labels
* Clear section headings
* Appropriate font weights

Hierarchy should resemble:

```text
Page Title
    ↓
Section Heading
    ↓
Metric
    ↓
Supporting Label
    ↓
Metadata
```

Avoid excessive font sizes.

Avoid using too many font weights.

---

# 9. GLOBAL LAYOUT

Use a desktop-first SaaS dashboard structure.

Conceptually:

```text
┌─────────────────────────────────────────────────────────────┐
│                         TOP BAR                             │
├───────────────┬─────────────────────────────────────────────┤
│               │                                             │
│   SIDEBAR     │              MAIN CONTENT                   │
│               │                                             │
│ Navigation    │  Page Header                                │
│               │                                             │
│ Projects      │  KPI / Summary Cards                        │
│ Site Updates  │                                             │
│ Schedule      │  Charts / Intelligence                      │
│ AI Assistant  │                                             │
│ Reviews       │                                             │
│ Reports       │                                             │
│ Audit Trail   │                                             │
│ Settings      │                                             │
│               │                                             │
└───────────────┴─────────────────────────────────────────────┘
```

Maintain a strong content grid.

---

# 10. SIDEBAR

Create a refined persistent sidebar.

Suggested navigation:

* Dashboard
* Projects
* Site Updates
* Schedule
* AI Assistant
* Review Queue
* Progress
* Reports
* Audit Trail
* Settings

Use appropriate icons.

The active navigation item should have:

* Subtle accent background
* Clear icon treatment
* High-contrast text
* Soft highlight

Do not make the sidebar visually heavy.

---

# 11. TOP NAVIGATION

Create a compact premium top bar.

Include where appropriate:

### Left

* Breadcrumb / current page

### Right

* Search
* Notifications
* Help
* User profile/avatar

Potentially include:

```text
Search...
```

with a keyboard shortcut such as:

```text
⌘ K
```

or:

```text
Ctrl K
```

if supported by the existing application.

---

# 12. DASHBOARD REDESIGN

The Dashboard should become the strongest visual page.

It should immediately communicate:

> **What is happening across projects right now?**

### Header

Example:

```text
Good morning, [User]

Project intelligence at a glance.
```

Do not necessarily use this exact copy if existing project context provides better wording.

---

# 13. KPI CARDS

Create premium metric cards.

Possible KaryaLink metrics:

### Active Projects

```text
12
```

### Progress Updated Today

```text
86%
```

### Pending Reviews

```text
07
```

### Schedule-linked Updates

```text
1,284
```

### Exceptions Detected

```text
14
```

### On-track Activities

```text
92%
```

Only display metrics that are actually available from the existing application/data.

**Do not invent fake metrics simply for visual appearance.**

If the application currently has mock/demo data, clearly maintain the existing demo-data behavior rather than pretending it is production data.

---

# 14. PROJECT CARDS

Project cards should visually resemble premium SaaS asset cards.

Each project card may contain:

* Project name
* Project ID
* Location
* Current phase
* Progress
* Planned progress
* Actual progress
* Status
* Last update
* Number of exceptions

Example structure:

```text
Project Alpha

Infrastructure Development
───────────────

Actual Progress       68%
Planned Progress      72%

██████████████░░░░

Status: At Risk

Last update
18 minutes ago
```

Use visual hierarchy rather than excessive text.

---

# 15. PLANNED VS ACTUAL VISUALIZATION

This is one of the most important KaryaLink concepts.

Create a visually strong chart showing:

```text
Planned Progress
vs
Actual Progress
```

Possible visualization:

* Line chart
* Area chart
* Progress comparison
* Timeline chart

Use the existing charting library where available.

The chart should make schedule deviation immediately understandable.

---

# 16. SITE UPDATE ACTIVITY

Create an activity section showing recent updates.

Example:

```text
Recent Site Updates

08:42 AM
Supervisor submitted voice update

"Concrete work completed at Block B"

AI Linked
→ L5.2.4 Concrete Work

Confidence
94%

Updated automatically
```

Use status indicators.

Possible statuses:

* AI Linked
* Needs Review
* Awaiting Clarification
* Schedule Updated
* Exception Detected

---

# 17. AI CONFIDENCE UI

Confidence should be a first-class visual concept.

Example:

```text
AI MATCH

L5.2.4 — Concrete Work

94% confidence
```

Use a compact visual confidence indicator.

For example:

```text
██████████████████░░
94%
```

Low-confidence matches should visually communicate that human review is required.

Example:

```text
68% Confidence

Needs Planner Review
```

This reinforces KaryaLink's:

> **Ask, Don't Guess**

principle.

---

# 18. REVIEW QUEUE

Create a professional review interface.

Example:

```text
Needs Your Review

01  Site update
    "Pipe section installed"

    Suggested activity:
    Erect Line 24"-P-1021

    Confidence: 71%

    [Approve] [Edit] [Ask]
```

The review interface should be fast and easy to scan.

Use:

* Priority
* Confidence
* Activity
* Timestamp
* Project
* Suggested match
* Actions

---

# 19. AI ASSISTANT

KaryaLink should have a dedicated AI/site assistant interface where applicable.

The assistant should feel like an **operational project assistant**, not a generic chatbot.

Possible capabilities:

* Submit site update
* Ask about project progress
* Find schedule activity
* Explain why an update was linked
* Ask for missing information
* Identify delayed activities
* Summarize project status

Use a compact, professional conversational UI.

---

# 20. SCHEDULE PAGE

Create a polished schedule intelligence interface.

Potential elements:

* Project selector
* Date range
* Schedule activities
* L5/L6 hierarchy
* Planned dates
* Actual dates
* Progress
* Status
* AI-linked updates

Use:

* Timeline
* Table
* Gantt-like visualization
* Progress bars

where supported by the existing application.

---

# 21. PROJECT DETAIL PAGE

Create a high-quality project overview.

Suggested structure:

```text
Project Header
      ↓
Project KPIs
      ↓
Progress Overview
      ↓
Planned vs Actual
      ↓
Schedule Timeline
      ↓
Recent Site Updates
      ↓
Exceptions
      ↓
Activity History
```

The page should feel information-dense without becoming cluttered.

---

# 22. REPORTS

Reports should use a clean data visualization layout.

Possible sections:

* Progress summary
* Schedule variance
* Site update volume
* AI matching accuracy/confidence
* Review workload
* Exceptions
* Project trends

Use charts only where the underlying data exists.

---

# 23. AUDIT TRAIL

Create a trustworthy enterprise audit interface.

Show:

* Timestamp
* User
* Site update
* AI action
* Schedule activity
* Confidence
* Human review
* Final action

Example:

```text
09:42:18

Site Update Received
        ↓
AI Activity Match
        ↓
L5.2.4 Concrete Work
        ↓
Confidence: 96%
        ↓
Schedule Updated
```

Make this visually communicate traceability and accountability.

---

# 24. CARDS & COMPONENTS

Use a consistent design system.

Cards should have:

* Rounded corners
* Subtle borders
* Subtle elevation
* Controlled contrast
* Consistent padding

Avoid excessive shadows.

Use subtle gradients only where they improve hierarchy.

---

# 25. GLASS / GLOW EFFECTS

Use these carefully.

Good:

* Subtle border glow
* Very soft background gradients
* Accent glow around important AI components
* Soft hover effects

Avoid:

* Heavy neon
* Excessive blur
* Strong glassmorphism everywhere
* Overly colorful backgrounds

The result should feel **premium and enterprise**, not flashy.

---

# 26. MICRO-INTERACTIONS

Add subtle polished interactions.

Examples:

* Sidebar active transition
* Card hover
* Button hover
* Chart tooltip
* Progress animation
* Page transition
* Modal entrance
* Dropdown animation
* Notification animation
* AI processing state

Animations should be:

* Fast
* Smooth
* Purposeful
* Non-distracting

Do not add animation simply for decoration.

---

# 27. LOADING STATES

Create polished loading states.

Use:

* Skeleton loaders
* Shimmer effects
* AI processing indicators
* Chart skeletons

Avoid blank white/black loading screens.

---

# 28. EMPTY STATES

Every major page should have a useful empty state.

Example:

```text
No site updates yet

Once supervisors submit progress,
KaryaLink will automatically analyze
and link updates to the project schedule.
```

Use an appropriate icon/illustration.

---

# 29. ERROR STATES

Create professional error states.

They should:

* Explain the issue
* Provide a useful action
* Preserve the application's visual language

Avoid raw browser errors.

---

# 30. RESPONSIVE DESIGN

The redesign MUST be fully responsive.

### Desktop

Use:

* Persistent sidebar
* Multi-column dashboard
* Large charts
* Dense project information

### Tablet

Adapt:

* Grid columns
* Sidebar
* Cards
* Charts

### Mobile

Use:

* Collapsible/mobile navigation
* Stacked cards
* Horizontal scrolling where appropriate
* Bottom navigation if it fits the existing product architecture
* Touch-friendly controls

Do not simply shrink the desktop UI.

---

# 31. ACCESSIBILITY

Maintain:

* Sufficient contrast
* Keyboard navigation
* Visible focus states
* Semantic HTML
* Accessible buttons
* Accessible form labels
* Tooltips where icons are ambiguous

Do not sacrifice usability for visual appearance.

---

# 32. TECHNICAL IMPLEMENTATION

Before introducing new libraries:

**Check the existing project dependencies.**

Prefer existing libraries already used by the project.

For example, if the project already uses:

* React
* Vite
* Tailwind CSS
* Recharts

continue using them.

Do not introduce a large dependency simply to create one visual effect.

---

# 33. COMPONENT REUSABILITY

Build reusable components where appropriate.

Examples:

```text
DashboardCard
MetricCard
ProjectCard
StatusBadge
ProgressBar
ConfidenceIndicator
ActivityItem
ReviewCard
ChartCard
PageHeader
Sidebar
Topbar
Modal
DataTable
EmptyState
LoadingState
```

Do not create duplicated styling for every page.

Maintain a consistent design system.

---

# 34. DATA & FUNCTIONALITY

**Do not destroy the existing backend/API integration.**

Before changing a component:

1. Understand its data source.
2. Preserve existing API calls.
3. Preserve existing state management.
4. Preserve existing routes.
5. Preserve existing interactions.
6. Preserve authentication if already implemented.

The redesign is primarily a **frontend/UI/UX improvement**, not a reason to rewrite the backend.

---

# 35. DO NOT USE FAKE FEATURES

Do not add fake functionality merely because it makes the interface look impressive.

If a UI feature is visually necessary but backend functionality is not yet implemented:

* Build the UI structure cleanly.
* Keep it clearly compatible with future integration.
* Do not falsely claim that the feature is operational.

Do not fabricate:

* AI accuracy
* Project counts
* Real-time data
* Financial savings
* Production users
* Deployment statistics
* Government integrations
* Schedule synchronization
* External APIs

unless the existing project actually provides them.

---

# 36. PRESERVE THE KARYALINK DOMAIN

Every visual component must reinforce the actual product.

KaryaLink is about:

```text
Site Updates
       ↓
Data Extraction
       ↓
AI Activity Linking
       ↓
L5/L6 Schedule
       ↓
Confidence
       ↓
Update / Ask / Review
       ↓
Progress Tracking
       ↓
Plan vs Actual
       ↓
Audit
```

The interface should make this workflow understandable visually.

---

# 37. DESIGN REFERENCE TRANSLATION

Use the attached reference as inspiration for:

### Navigation

Dark compact sidebar.

### Dashboard

Large title + metrics + cards.

### Cards

Rounded, premium, dark surfaces.

### Charts

Clean charts integrated into cards.

### Buttons

Compact, modern, rounded.

### Borders

Very subtle.

### Typography

Large, clean, modern.

### Spacing

Generous but controlled.

### Visual hierarchy

Strong.

### Interaction

Smooth and responsive.

### Overall impression

**Premium enterprise SaaS.**

---

# 38. IMPORTANT — DO NOT OVERDESIGN

The objective is:

> **Beautiful + Professional + Functional + Data-Dense + Easy to Understand**

Not:

> **Decorative + Overanimated + Visually Noisy**

Every visual element must serve a purpose.

---

# 39. IMPLEMENTATION ORDER

Follow this order.

## STEP 1 — AUDIT

Inspect the current project.

Identify:

* Current pages
* Current routes
* Current components
* Current data
* Existing functionality
* Existing styling
* Unfinished work

## STEP 2 — CONTINUE

Finish the work that was already in progress before the usage limit stopped the previous task.

Do not restart completed work.

## STEP 3 — BRANDING

Change the product/site name everywhere to:

**KaryaLink**

Descriptor:

**Site-to-Schedule Intelligence**

## STEP 4 — DESIGN SYSTEM

Establish:

* Colors
* Typography
* Spacing
* Borders
* Radius
* Shadows
* Buttons
* Status colors
* Cards
* Inputs
* Navigation

## STEP 5 — GLOBAL LAYOUT

Redesign:

* Sidebar
* Topbar
* Main content
* Responsive navigation

## STEP 6 — DASHBOARD

Make the dashboard the strongest page.

## STEP 7 — CORE PRODUCT PAGES

Improve:

* Projects
* Site Updates
* Schedule
* AI Assistant
* Review Queue
* Progress
* Reports
* Audit Trail
* Settings

Only redesign pages/routes that actually exist or are required by the current application.

## STEP 8 — RESPONSIVENESS

Test:

* Desktop
* Laptop
* Tablet
* Mobile

## STEP 9 — POLISH

Add:

* Micro-interactions
* Hover states
* Loading states
* Empty states
* Error states
* Smooth transitions

## STEP 10 — FINAL QA

Check:

* No broken routes
* No console errors
* No broken API calls
* No layout overflow
* No overlapping components
* No unreadable text
* No inconsistent spacing
* No inconsistent branding
* No old product name
* No broken mobile layout

---

# 40. PERFORMANCE

Do not sacrifice performance for visual effects.

Avoid:

* Heavy unnecessary animations
* Huge background images
* Unoptimized assets
* Excessive DOM complexity
* Unnecessary dependencies

Keep the application fast.

---

# 41. FINAL VISUAL STANDARD

When finished, the application should feel like a polished commercial SaaS product.

The first impression should communicate:

> **KaryaLink is a serious enterprise-grade project intelligence platform.**

The interface should visually communicate:

**Infrastructure + AI + Schedule Intelligence + Real-Time Progress + Human Review + Auditability**

---

# 42. FINAL CHECKLIST

Before declaring the task complete, verify:

### Continuation

* [ ] Existing implementation was inspected
* [ ] Previous unfinished work was continued
* [ ] Completed functionality was preserved

### Branding

* [ ] Product name is KaryaLink everywhere
* [ ] Old product name removed
* [ ] Browser title updated
* [ ] Logo/brand updated
* [ ] Favicon updated where applicable

### Design

* [ ] Dark premium SaaS theme
* [ ] Sidebar redesigned
* [ ] Topbar redesigned
* [ ] Cards redesigned
* [ ] Charts redesigned
* [ ] Buttons redesigned
* [ ] Typography improved
* [ ] Spacing consistent
* [ ] Borders consistent
* [ ] Visual hierarchy strong

### KaryaLink UX

* [ ] Site Updates
* [ ] AI Activity Linking
* [ ] Confidence
* [ ] Review Queue
* [ ] Schedule
* [ ] Planned vs Actual
* [ ] Progress
* [ ] Audit Trail

are visually represented wherever those features exist in the application.

### Responsive

* [ ] Desktop
* [ ] Tablet
* [ ] Mobile

### Technical

* [ ] Existing APIs preserved
* [ ] Existing routes preserved
* [ ] Existing functionality preserved
* [ ] No unnecessary dependencies
* [ ] No console errors
* [ ] No broken functionality

### Quality

* [ ] No overlapping elements
* [ ] No overflow
* [ ] No inconsistent spacing
* [ ] No placeholder text
* [ ] No fake claims
* [ ] No old branding
* [ ] No unnecessary redesign of working logic

---

# FINAL INSTRUCTION

**Start by inspecting the current project and understanding exactly where the previous task stopped.**

**Continue the existing work from that point. Do not restart from scratch.**

Then change the product branding to:

# KaryaLink

**Site-to-Schedule Intelligence**

After that, redesign and polish the frontend using the attached files inside the `references/` folder as visual references.

The attached image and video are **design references only**. Do not copy their domain, branding, text, or exact UI.

Translate their visual quality into a unique KaryaLink experience.

The final result should be:

> **A premium, modern, dark-mode, enterprise-grade infrastructure project management and AI schedule-intelligence platform.**

Prioritize:

**Functionality → Clarity → Visual Hierarchy → Consistency → Responsiveness → Polish**

Do not break existing functionality.

Do not invent unsupported functionality.

Do not restart completed work.

**Continue from where the previous task stopped and complete the frontend redesign professionally.**
