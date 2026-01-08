# Refined Application Specification: AvailableTime

## 1. Overview
**App Name:** AvailableTime
**Goal:** A web app to visualize and find overlapping meeting slots across multiple timezones. It helps coordinate meetings for attendees in different regions (e.g., Beijing, US, Israel, India) by highlighting mutually convenient times. Reference the Outlook calendar view and Teams Calendar view.

## 2. User Stories & Features

### 2.1. Multi-Timezone Visualization
- **Main View:** A "Day View" or "Week View" grid.
- **Columns/Rows:** 
    - The primary view should likely be a vertical timeline (Hours of the day) or a horizontal one.
    - Given multiple timezones, a **Comparison View** is best:
        - Rows: Each selected Timezone (e.g., Row 1: Beijing, Row 2: PST, Row 3: EST).
        - Columns: Hours of the day (aligned so that the vertical column represents the *same absolute moment* in time).
- **Default Configuration:**
    - **Base:** UTC+8 (Beijing).
    - **Defaults:** PST (Pacific), EST (Eastern), IST (India), IST (Israel). 
    - **Focus:** Focus to the current time of Beijing. Use a vertical dot line alongside with a label to mark the current time. Auto refresh.

### 2.2. Timezone Management
- **Add Timezone:** A search/dropdown menu to add cities/zones (backed by IANA timezone database).
- **Remove Timezone:** Option to remove a row from the view.
- **Persistence:** (Recommended) The app should save the list of currently active timezones so the user doesn't have to re-add them every time they open the app.

### 2.3. Availability Highlighting (The Core Logic)
- **Working Hours:** Defined as **07:30 to 18:00** (Local Time) for each timezone.
- **Overlap Logic:** 
    - The app will calculate the intersection of "Working Hours" for all currently visible timezones.
    - **Visual Cue:** 
        - Non-working hours: Grayed out or dimmed.
        - Working hours: White/Light background.
        - **Perfect Overlap:** A distinct highlight (e.g., Green) on the time slots where *everyone* is within their 07:30-18:00 window.
    - *Note:* For widely separated zones (e.g., Beijing vs. New York), overlaps might be rare or non-existent. The visualization will make this obvious.

### 2.4. Interaction
- **Cursor Selection:** 
    - Hovering or clicking a 30-minute slot highlights that column across all timezone rows.
    - A tooltip or side panel displays the exact local time for that slot in every active timezone.
- **Date Navigation:** Ability to switch days (Next Day / Previous Day / Date Picker) to handle DST changes correctly.

### 2.5. DST Handling
- Automatic adjustment using Python's `zoneinfo` library to respect Daylight Saving Time rules for specific dates.

## 3. Technical Stack

### 3.1. Core Technology
- **Language:** Python 3.10+


### 3.3. Data Storage
- **Settings File:** A simple `settings.json` to store:
    - List of active timezones.
    - User's preferred "Working Hours" (if we want to make 7:30-18:00 configurable later).

## 4. UI Design Concept
- **Style:** Minimalist, clean lines.
- **Layout:**
    - **Top Bar:** Date Picker | Add Timezone Button | Settings.
    - **Main Area:** 
        - Left Header: Timezone Names (e.g., "Beijing", "New York").
        - Center: Scrollable Timeline Grid (30-min increments).
    - **Bottom/Side Panel:** "Selected Time Details" (Summary of the selected slot).
    - **Scrollable** Focus on the current time pillar, support scroll to view other hours.

## 5. Clarifications
1. **Persistence:** Save the *list of timezones* (configuration) so I don't have to re-setup every time. Yes. please do.
2. **Zero Overlap:** If Beijing (UTC+8) and New York (UTC-5) have no overlap in the 7:30-18:00 window, the app can suggest the best available time, expand the working hours to 7:00 AM to 21:00 PM.
