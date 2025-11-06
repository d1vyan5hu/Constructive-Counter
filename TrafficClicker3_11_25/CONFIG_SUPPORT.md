# CRClicker Configuration Support

This document describes all configuration features supported by CRClicker, including the latest additions for text input and conditional steps.

## Configuration File Structure

The configuration file is a JSON file with a single `steps` array:

```json
{
  "steps": [
    // Step definitions here
  ]
}
```

## Step Types

### 1. Choice Steps (Default)

Choice steps display multiple buttons for selection. This is the default type if no `type` is specified.

**Required Fields:**
- `step_id` (string): Unique identifier for this step (used in CSV export)
- `question` (string): The question text displayed to the user
- `choices` (array): Array of choice objects

**Optional Fields:**
- `condition` (object): Conditional logic (see Conditional Steps below)

**Choice Object Structure:**
```json
{
  "value": "car",      // Stored value (required)
  "label": "Car"       // Display label (required)
}
```

**Example:**
```json
{
  "step_id": "VehicleType",
  "question": "What type of vehicle?",
  "choices": [
    {"value": "car", "label": "Car"},
    {"value": "truck", "label": "Truck"},
    {"value": "motorcycle", "label": "Motorcycle"}
  ]
}
```

---

### 2. Text Input Steps

Text input steps allow free-form text entry instead of predefined choices.

**Required Fields:**
- `step_id` (string): Unique identifier for this step
- `question` (string): The question text displayed to the user
- `type` (string): Must be `"text"` to enable text input

**Optional Fields:**
- `placeholder` (string): Placeholder text in the input field (default: `"Enter text..."`)
- `submitLabel` (string): Text on the submit button (default: `"Submit"`)
- `condition` (object): Conditional logic (see Conditional Steps below)

**Example:**
```json
{
  "step_id": "LicensePlate",
  "question": "License Plate Number",
  "type": "text",
  "placeholder": "Enter license plate (if visible)",
  "submitLabel": "Continue"
}
```

**Features:**
- Users can press Enter to submit
- Submit button is disabled until text is entered
- Input auto-focuses when modal opens
- Values are preserved when navigating back

---

## Conditional Steps

Steps can be conditionally shown/hidden based on previous selections. This allows dynamic workflows where different questions appear based on earlier answers.

### Condition Structure

```json
{
  "condition": {
    "step_id": "PreviousStepId",  // Required: reference to a previous step
    "operator": "==",             // Optional: operator (default: "==")
    "value": "someValue",          // Required for ==, != operators
    "values": ["a", "b"]          // Required for "in", "not in" operators
  }
}
```

### Supported Operators

#### 1. Equality (`==` or `=`) - Default
Show step only if previous step equals a specific value.

```json
{
  "step_id": "AgeGroup",
  "question": "Age Group?",
  "choices": [...],
  "condition": {
    "step_id": "VehicleType",
    "value": "Pedestrian"
  }
}
```

#### 2. Not Equal (`!=`)
Show step only if previous step does NOT equal a specific value.

```json
{
  "step_id": "Notes",
  "question": "Additional Notes",
  "type": "text",
  "condition": {
    "step_id": "VehicleType",
    "operator": "!=",
    "value": "truck"
  }
}
```

#### 3. In List (`in`)
Show step if previous step value is in a list of values.

```json
{
  "step_id": "LicensePlate",
  "question": "License Plate Number",
  "type": "text",
  "condition": {
    "step_id": "VehicleType",
    "operator": "in",
    "values": ["SingleUnitTruck", "ArticulatedTruck", "Bus"]
  }
}
```

#### 4. Not In List (`not in`)
Show step if previous step value is NOT in a list of values.

```json
{
  "step_id": "AgeGroup",
  "question": "Age Group?",
  "choices": [...],
  "condition": {
    "step_id": "VehicleType",
    "operator": "not in",
    "values": ["Pedestrian", "Bicycle"]
  }
}
```

---

## How Conditional Steps Work

1. **Step Evaluation**: When moving forward, the system evaluates all steps starting from the current position
2. **Condition Checking**: For each step with a `condition`, the system checks if the condition is met based on values already selected in the current entry
3. **Automatic Skipping**: Steps that don't meet their condition are automatically skipped
4. **Progress Bar**: The progress bar adjusts to show only valid steps (conditionally hidden steps are excluded from the count)
5. **Back Navigation**: When going back, the system finds the previous valid step (one that would have been shown based on current selections)

---

## Complete Example

Here's a comprehensive example combining all features:

```json
{
  "steps": [
    {
      "step_id": "VehicleType",
      "question": "Vehicle Type",
      "choices": [
        {"value": "truck", "label": "Truck"},
        {"value": "bus", "label": "Bus"},
        {"value": "pedestrian", "label": "Pedestrian"},
        {"value": "bicycle", "label": "Bicycle"}
      ]
    },
    {
      "step_id": "LicensePlate",
      "question": "License Plate Number",
      "type": "text",
      "placeholder": "Enter license plate...",
      "submitLabel": "Continue",
      "condition": {
        "step_id": "VehicleType",
        "operator": "in",
        "values": ["truck", "bus"]
      }
    },
    {
      "step_id": "AgeGroup",
      "question": "Age Group?",
      "choices": [
        {"value": "child", "label": "Child (0-12)"},
        {"value": "adult", "label": "Adult (13-64)"},
        {"value": "senior", "label": "Senior (65+)"}
      ],
      "condition": {
        "step_id": "VehicleType",
        "value": "pedestrian"
      }
    },
    {
      "step_id": "DeviceType",
      "question": "Mobility Device Type",
      "type": "text",
      "placeholder": "Enter device type...",
      "condition": {
        "step_id": "VehicleType",
        "value": "bicycle"
      }
    },
    {
      "step_id": "Notes",
      "question": "Additional Notes",
      "type": "text",
      "placeholder": "Enter any notes...",
      "condition": {
        "step_id": "VehicleType",
        "operator": "!=",
        "value": "pedestrian"
      }
    }
  ]
}
```

**Workflow Example:**
- User selects "truck" → Shows: LicensePlate, Notes
- User selects "pedestrian" → Shows: AgeGroup
- User selects "bicycle" → Shows: DeviceType, Notes
- User selects "bus" → Shows: LicensePlate, Notes

---

## Important Rules

1. **First Step**: The first step (`steps[0]`) should never have a condition, as there are no previous selections to evaluate
2. **Condition References**: Conditions must reference a `step_id` that appears earlier in the steps array
3. **Value Types**: All values are compared as strings (case-sensitive)
4. **Multiple Conditions**: Currently, only single-condition checks are supported (one condition per step)
5. **Conditional Text Input**: Text input steps can be conditional just like choice steps
6. **Back Navigation**: When going back, the system intelligently skips over steps that wouldn't have been shown based on current selections

---

## CSV Export

All step values are exported to CSV with the `step_id` as the column header. The exported CSV includes:
- All step values (choices and text inputs)
- `playback_time_seconds`: Video playback time when entry was made
- `click_x`, `click_y`: Click coordinates on video
- `ocr_timestamp`: Timestamp extracted from video frame (if OCR is enabled)
- Metadata fields: `Street Name`, `GUID`, `Site Description`, `Video File`

---

## Best Practices

1. **Use Descriptive step_ids**: Use clear, consistent naming (e.g., `VehicleType` not `vt`)
2. **Keep Choices Consistent**: Use the same value format across related steps
3. **Test Conditional Logic**: Ensure conditional steps work for all possible paths
4. **Provide Clear Questions**: Make questions unambiguous
5. **Use Text Input Sparingly**: Text input is slower than choices; use it for truly variable data
6. **Place Common Steps First**: Steps without conditions should generally come first
7. **Validate Condition References**: Ensure all `step_id` references in conditions exist earlier in the array

---

## Limitations

1. **Single Condition Only**: Each step can only have one condition (no AND/OR combinations)
2. **Forward References**: Conditions can only reference steps that appear earlier in the array
3. **No Nested Conditions**: Conditions cannot reference other conditional steps' results in complex ways
4. **String Comparison**: All value comparisons are string-based (case-sensitive)
5. **No Validation Rules**: Text inputs don't support validation rules (min/max length, patterns, etc.)

---

## Migration Notes

- **Old Configs**: Configs without `type` fields will continue to work as choice steps
- **Conditional Steps**: Old configs without conditions will work unchanged
- **Backward Compatible**: All existing config files remain valid

