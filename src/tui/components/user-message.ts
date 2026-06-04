import { theme } from "../theme/theme.js";
import { MarkdownMessageComponent } from "./markdown-message.js";

/**
 * User message component.
 *
 * P1-4: User messages are visually distinct with warm background color.
 * Bubble width capped at ~70% of terminal width through word wrap.
 */
export class UserMessageComponent extends MarkdownMessageComponent {
  constructor(text: string) {
    super(text, 1, {
      bgColor: (line) => theme.userBg(line),
      color: (line) => theme.userText(line),
    });
  }
}
