import HeaderTitle from '@components/views/HeaderTitle'
import { MarkdownStyle } from '@lib/markdown/Markdown'
import { Theme } from '@lib/theme/ThemeManager'
import React from 'react'
import { StyleSheet, Platform, ScrollView } from 'react-native'
import Markdown from 'react-native-markdown-display'
import { SafeAreaView } from 'react-native-safe-area-context'

const markdownData = `
# Heading 1
## Heading 2
### Heading 3
#### Heading 4
##### Heading 5
###### Heading 6
Here's some regular text

---

A **strong** (bold) text example.

A *emphasized* (italic) text example.

A ~~strikethrough~~ text example.

> This is a blockquote.  
> > This is a nested blockquote.
> 
> Exit
> > Again!

- Bullet list item 1
- Bullet list item 2
- Bullet list item 3

1. Ordered list item 1
2. Ordered list item 2
3. Ordered list item 3

A list inside a list:

- Item 1
  - Sub-item 1
  - Sub-item 2

Inline \`code_inline\` example.

\`\`\`SourceInfo
Here is a block code
\`\`\`


Latex Plugin:
- Block:

$$\\frac{d}{dx} \\left( \\int_{0}^{x} e^{-t^2} \\, dt \\right)^2$$

- Inline: 

$s = ut + \\frac{1}{2}at^2$ distance from initial velocity, time and acceleration

| Row One  | Row Two | Row Three   |
|----------|--------:|-------------|
| Item 1   |  row    | row         |
| Item 2   |  row    | row         |
| Item 3   |  row    | row         |
| Item 4   |  row    | row         |


`

const MarkdownTestScreen = () => {
    const markdownStyle = MarkdownStyle.useMarkdownStyle()
    return (
        <SafeAreaView edges={['bottom']}>
            <ScrollView contentContainerStyle={{ padding: 16 }}>
                <HeaderTitle title="Markdown Test" />
                <Markdown
                    mergeStyle={false}
                    markdownit={MarkdownStyle.Rules}
                    rules={MarkdownStyle.RenderRules}
                    style={markdownStyle}>
                    {markdownData}
                </Markdown>
            </ScrollView>
        </SafeAreaView>
    )
}

export default MarkdownTestScreen
