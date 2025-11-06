# CRClicker Config Guide

This guide explains how to create configuration files for CRClicker with support for text input and conditional steps.

## Basic Structure

The config file is a JSON file with a `steps` array. Each step represents a question or input field shown to the user.

```json
{
  "steps": [
    {
      "step_id": "VehicleType",
      "question": "Vehicle Type",
      "choices": [...]
    }
  ]
}
```

## Step Types

### 1. Choice Steps (Default)

Choice steps display multiple buttons for the user to select from.

```json
{
  "step_id": "VehicleType",
  "question": "Vehicle Type",
  "choices": [
    {"value": "car", "label": "Car"},
    {"value": "truck", "label": "Truck"},
    {"value": "bicycle", "label": "Bicycle"}
  ]
}
```

**Fields:**
- `step_id` (required): Unique identifier for this step
- `question` (required): The question text displayed to the user
- `choices` (required): Array of choice objects with `value` and `label`

### 2. Text Input Steps

Text input steps allow free-form text entry.

```json
{
  "step_id": "LicensePlate",
  "question": "License Plate Number",
  "type": "text",
  "placeholder": "Enter license plate (if visible)",
  "submitLabel": "Continue"
}
```

**Fields:**
- `step_id` (required): Unique identifier for this step
- `question` (required): The question text displayed to the user
- `type` (required): Must be `"text"` for text input steps
- `placeholder` (optional): Placeholder text in the input field (default: "Enter text...")
- `submitLabel` (optional): Text on the submit button (default: "Submit")

**Note:** Users can press Enter to submit, or click the submit button. The submit button is disabled until text is entered.

## Conditional Steps

You can make steps conditional based on previous selections. Steps will only appear if their condition is met.

### Basic Condition (Equality)

Show step only if a previous step equals a specific value:

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

### Condition Operators

#### Equality (`==` or `=`)
```json
"condition": {
  "step_id": "VehicleType",
  "value": "Pedestrian"
}
```

#### Not Equal (`!=`)
```json
"condition": {
  "step_id": "VehicleType",
  "operator": "!=",
  "value": "Bus"
}
```

#### In List (`in`)
Show step if previous step value is in a list:

```json
"condition": {
  "step_id": "VehicleType",
  "operator": "in",
  "values": ["SingleUnitTruck", "ArticulatedTruck", "Bus"]
}
```

#### Not In List (`not in`)
Show step if previous step value is NOT in a list:

```json
"condition": {
  "step_id": "VehicleType",
  "operator": "not in",
  "values": ["Pedestrian", "Bicycle"]
}
```

## Complete Example

Here's a complete example combining all features:

```json
{
  "steps": [
    {
      "step_id": "VehicleType",
      "question": "Vehicle Type",
      "choices": [
        {"value": "truck", "label": "Truck"},
        {"value": "bus", "label": "Bus"},
        {"value": "pedestrian", "label": "Pedestrian"}
      ]
    },
    {
      "step_id": "LicensePlate",
      "question": "License Plate Number",
      "type": "text",
      "placeholder": "Enter license plate...",
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
        {"value": "child", "label": "Child"},
        {"value": "adult", "label": "Adult"},
        {"value": "senior", "label": "Senior"}
      ],
      "condition": {
        "step_id": "VehicleType",
        "value": "pedestrian"
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
        "value": "truck"
      }
    }
  ]
}
```

## How Conditional Steps Work

1. **Step Evaluation**: When moving to the next step, the system evaluates all steps starting from the current position.
2. **Condition Checking**: For each step, if it has a `condition`, the system checks if the condition is met based on previous selections.
3. **Skipping**: Steps that don't meet their condition are automatically skipped.
4. **Progress Bar**: The progress bar adjusts to show only valid steps.
5. **Back Navigation**: When going back, the system finds the previous valid step (one that would have been shown).

## Important Notes

- **First Step**: The first step (`steps[0]`) should never have a condition, as there are no previous selections.
- **Condition References**: Conditions must reference a `step_id` that appears earlier in the steps array.
- **Conditional Text Input**: Text input steps can be conditional just like choice steps.
- **Multiple Conditions**: Currently, each step can only have one condition. Use `operator: "in"` for multiple values.
- **Dynamic Flow**: The flow adapts based on user selections, so the total number of steps shown may vary.

## Tips

1. **Plan Your Flow**: Think about which paths users might take before designing conditions.
2. **Test Your Config**: Load your config and test different selection paths to ensure conditions work as expected.
3. **Use Descriptive IDs**: Use clear, descriptive `step_id` values (e.g., "VehicleType" not "vt").
4. **Order Matters**: Steps are evaluated in order, so place conditional steps after the steps they depend on.



