# UI Config Editor Infinite Loop Fix

**Date**: 2026-08-16  
**Issue**: Maximum update depth exceeded in UI Config Editor

---

## 🐛 Problem

The UI Config Editor was causing infinite loops with the error:
```
Maximum update depth exceeded. This can happen when a component calls 
setState inside useEffect, but useEffect either doesn't have a dependency 
array, or one of the dependencies changes on every render.
```

**Affected Components**:
1. `FieldConfigPanel.tsx` (line 159)
2. `UIConfigEditor.tsx` (line 277)

---

## 🔍 Root Cause

### Issue 1: Function recreated on every render
**File**: `UIConfigEditor.tsx` (line 275)

```typescript
// ❌ BEFORE: Function recreated on every render
const handleFieldConfigChange = (config: any) => {
  setPendingChanges((prev) => ({
    ...prev,
    [config.fieldPath]: config,
  }));
  setHasUnsavedChanges(true);
};
```

The `handleFieldConfigChange` function was recreated on every render, causing:
1. FieldConfigPanel receives new `onChange` prop
2. FieldConfigPanel's `useEffect` runs (dependency: `onChange`)
3. Calls `onChange(config)`
4. Parent re-renders
5. New `handleFieldConfigChange` created
6. **INFINITE LOOP** 🔄

---

### Issue 2: useEffect with changing dependencies
**File**: `FieldConfigPanel.tsx` (line 152-164)

```typescript
// ❌ BEFORE: onChange in dependency array causes infinite loop
useEffect(() => {
  if (selectedPath && config.fieldPath) {
    const fullPath = wrapperPrefix 
      ? `${wrapperPrefix}.${config.fieldPath}` 
      : config.fieldPath;
    
    onChange({
      ...config,
      fieldPath: fullPath,
    });
  }
}, [config, selectedPath, wrapperPrefix, onChange]); // ❌ onChange changes every render
```

Every time `config` changes:
1. useEffect runs
2. Calls `onChange()`
3. Parent updates state
4. Parent re-renders
5. New `onChange` function created
6. useEffect runs again
7. **INFINITE LOOP** 🔄

---

## ✅ Solution

### Fix 1: Wrap function in useCallback
**File**: `UIConfigEditor.tsx`

```typescript
// ✅ AFTER: Function memoized with useCallback
const handleFieldConfigChange = useCallback((config: any) => {
  setPendingChanges((prev) => ({
    ...prev,
    [config.fieldPath]: config,
  }));
  setHasUnsavedChanges(true);
}, []); // Empty dependency array - function never changes
```

**Changes**:
- Added `useCallback` import
- Wrapped function in `useCallback` with empty dependency array
- Function identity remains stable across renders

---

### Fix 2: Use ref to track initialization
**File**: `FieldConfigPanel.tsx`

```typescript
// ✅ AFTER: Track initialization with refs
const isInitialMount = useRef(true);
const previousPath = useRef<string | null>(null);

useEffect(() => {
  // Skip initial mount
  if (isInitialMount.current) {
    isInitialMount.current = false;
    previousPath.current = selectedPath;
    return;
  }

  // Skip if path changed (handled by initialization effect)
  if (previousPath.current !== selectedPath) {
    previousPath.current = selectedPath;
    return;
  }

  if (selectedPath && config.fieldPath) {
    const fullPath = wrapperPrefix 
      ? `${wrapperPrefix}.${config.fieldPath}` 
      : config.fieldPath;
    
    onChange({
      ...config,
      fieldPath: fullPath,
    });
  }
}, [config]); // ✅ Only depends on config, not onChange
```

**Changes**:
- Added `useRef` import
- Track initial mount with `isInitialMount` ref
- Track previous path with `previousPath` ref
- Skip effect on initial mount
- Skip effect when path changes (handled by other effect)
- Removed `onChange` from dependency array
- Only trigger when `config` actually changes

---

## 📁 Files Modified

| File | Changes | Status |
|------|---------|--------|
| src/app/app/filing-config/UIConfigEditor.tsx | Added useCallback to handleFieldConfigChange | ✅ Fixed |
| src/app/app/filing-config/FieldConfigPanel.tsx | Added refs to prevent infinite loop | ✅ Fixed |

---

## 🧪 Testing

### Before Fix
```
Browser Console:
❌ Maximum update depth exceeded
❌ Component re-rendering infinitely
❌ Browser becomes unresponsive
❌ App crashes
```

### After Fix
```
Browser Console:
✅ No errors
✅ Component renders only when needed
✅ Browser responsive
✅ App works smoothly
```

---

## 🎯 Key Learnings

### 1. **useCallback for stable function identity**
When passing functions as props that will be used in child `useEffect` dependencies, wrap them in `useCallback`:

```typescript
// ❌ Bad: New function every render
const handler = (value) => setState(value);

// ✅ Good: Stable function identity
const handler = useCallback((value) => setState(value), []);
```

### 2. **Avoid putting functions in useEffect dependencies**
If possible, don't include functions in the dependency array:

```typescript
// ❌ Bad: Function in dependency array
useEffect(() => {
  onChange(data);
}, [data, onChange]); // onChange changes every render

// ✅ Good: Use ref or remove from dependencies
useEffect(() => {
  onChange(data);
}, [data]); // Only depends on data
```

### 3. **Use refs to track state across renders**
Refs don't trigger re-renders but persist across renders:

```typescript
const isInitialMount = useRef(true);

useEffect(() => {
  if (isInitialMount.current) {
    isInitialMount.current = false;
    return; // Skip first run
  }
  // Run on subsequent renders
}, [dependency]);
```

---

## 📊 Impact

**Before**:
- ❌ UI Config Editor completely broken
- ❌ Infinite loop crashes browser
- ❌ Cannot configure fields

**After**:
- ✅ UI Config Editor works smoothly
- ✅ No infinite loops
- ✅ Can configure fields normally
- ✅ Performance improved

---

**Fix Applied**: 2026-08-16 23:45 IST  
**Status**: ✅ **RESOLVED**
