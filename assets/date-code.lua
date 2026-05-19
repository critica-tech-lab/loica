-- Pandoc Lua filter: wrap date-like text in Code (monospace) spans.
-- Matches patterns like 2026-03-02, 03/02/2026, March 2 2026, etc.
-- Dates inside bold/italic keep their formatting (no Code box override).

-- U+2013 en-dash (pandoc smart typography may convert hyphens)
local endash = "\xE2\x80\x93"

local date_patterns = {
  -- ISO: 2026-03-02 (with hyphen or en-dash)
  "%d%d%d%d%-%d%d%-%d%d",
  "%d%d%d%d" .. endash .. "%d%d" .. endash .. "%d%d",
  -- Slash: 03/02/2026 or 2026/03/02
  "%d%d?/%d%d?/%d%d%d%d",
  "%d%d%d%d/%d%d?/%d%d?",
  -- Dot: 02.03.2026
  "%d%d?%.%d%d?%.%d%d%d%d",
}

local months = {
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
}

local month_patterns = {}
for _, m in ipairs(months) do
  table.insert(month_patterns, m .. " %d%d?,? %d%d%d%d")
  table.insert(month_patterns, "%d%d? " .. m .. " %d%d%d%d")
end

local function is_numeric_date(text)
  for _, pat in ipairs(date_patterns) do
    if text:match("^" .. pat .. "$") then
      return true
    end
  end
  return false
end

-- Normalize en-dashes back to hyphens in dates
local function normalize_date(text)
  local result = text:gsub(endash, "-")
  return result
end

-- Pass 1: Inside Strong/Emph, replace date Str with a monospace RawInline
-- so pass 2 won't touch it. RawInline is opaque to further Lua processing.
local function protect_date_str(el_text, format)
  local normalized = normalize_date(el_text)
  if format == "latex" then
    -- Use font family directly to avoid the \texttt colorbox override
    return pandoc.RawInline("latex",
      "{\\fontfamily{\\ttdefault}\\selectfont " .. normalized .. "}")
  elseif format == "html" or format == "html5" then
    return pandoc.RawInline("html",
      '<span style="font-family:monospace">' .. normalized .. '</span>')
  else
    return pandoc.Str(normalized)
  end
end

local output_format = FORMAT or "latex"

local pass1 = {
  Strong = function(el)
    local new = pandoc.List()
    local changed = false
    for _, inline in ipairs(el.content) do
      if inline.tag == "Str" and is_numeric_date(inline.text) then
        new:insert(protect_date_str(inline.text, output_format))
        changed = true
      else
        new:insert(inline)
      end
    end
    if changed then return pandoc.Strong(new) end
    return nil
  end,

  Emph = function(el)
    local new = pandoc.List()
    local changed = false
    for _, inline in ipairs(el.content) do
      if inline.tag == "Str" and is_numeric_date(inline.text) then
        new:insert(protect_date_str(inline.text, output_format))
        changed = true
      else
        new:insert(inline)
      end
    end
    if changed then return pandoc.Emph(new) end
    return nil
  end,
}

-- Pass 2: Convert remaining plain-text dates to Code.
local pass2 = {
  Str = function(el)
    if is_numeric_date(el.text) then
      return pandoc.Code(normalize_date(el.text))
    end
    return nil
  end,

  Inlines = function(inlines)
    local out = pandoc.List()
    local changed = false
    local i = 1
    while i <= #inlines do
      local el = inlines[i]
      local matched = false

      if el.tag == "Str" then
        local window = { el.text }
        local j = i + 1
        local elem_count = 1
        while j <= #inlines and elem_count < 5 do
          if inlines[j].tag == "Space" then
            table.insert(window, " ")
            elem_count = elem_count + 1
            j = j + 1
          elseif inlines[j].tag == "Str" then
            table.insert(window, inlines[j].text)
            elem_count = elem_count + 1
            j = j + 1
          else
            break
          end
        end
        local combined = table.concat(window)
        for _, pat in ipairs(month_patterns) do
          if combined:match("^" .. pat .. "$") then
            out:insert(pandoc.Code(combined))
            i = j
            matched = true
            changed = true
            break
          end
        end

        if not matched then
          out:insert(el)
          i = i + 1
        end
      else
        out:insert(el)
        i = i + 1
      end
    end
    if changed then return out end
    return nil
  end,

  HorizontalRule = function()
    return pandoc.RawBlock("latex",
      "\\vspace{17.5pt}\n\\noindent\\rule{\\textwidth}{0.4pt}\n\\vspace{17.5pt}")
  end,

  -- Force tables to span full text width with equal columns
  Table = function(tbl)
    local ncols = #tbl.colspecs
    if ncols > 0 then
      local w = 1.0 / ncols
      for i = 1, ncols do
        tbl.colspecs[i] = { tbl.colspecs[i][1], w }
      end
    end
    return tbl
  end,
}

return { pass1, pass2 }
