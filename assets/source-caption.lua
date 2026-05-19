-- Wrap paragraphs that begin with "Source:" in a sourcenote env so they
-- render as captions (smaller, lighter color) rather than body text.

local function leading_text(elem)
  for _, c in ipairs(elem.content) do
    local t = c.t
    if t == 'Image' or t == 'LineBreak' or t == 'SoftBreak' or t == 'Space' then
      -- skip
    elseif t == 'Str' then
      return c.text
    elseif t == 'Emph' or t == 'Strong' then
      local s = pandoc.utils.stringify(c)
      if s and #s > 0 then return s end
    else
      return nil
    end
  end
  return nil
end

function Para(elem)
  local first = leading_text(elem)
  if first and first:match('^Source') then
    return {
      pandoc.RawBlock('latex', '\\begin{sourcenote}'),
      elem,
      pandoc.RawBlock('latex', '\\end{sourcenote}'),
    }
  end
end
