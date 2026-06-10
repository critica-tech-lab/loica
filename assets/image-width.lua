-- image-width.lua
-- The Loica markdown serializer appends a `{width=Npx}` marker after a resized
-- image (gfm can't parse pandoc link attributes). This filter consumes that
-- marker and sets a real width attribute on the Image, so both the HTML
-- (WeasyPrint) and LaTeX (tectonic) writers render the image at its resized
-- size. Output-agnostic: it edits the AST before any writer runs.

function Inlines(inlines)
  local out = pandoc.List()
  local i = 1
  while i <= #inlines do
    local el = inlines[i]
    local nxt = inlines[i + 1]
    if el.t == 'Image' and nxt and nxt.t == 'Str' then
      local w = nxt.text:match('^{width=(%d+)px?}$')
      if w then
        el.attributes.width = w .. 'px'
        out:insert(el)
        i = i + 2
        goto continue
      end
    end
    out:insert(el)
    i = i + 1
    ::continue::
  end
  return out
end
