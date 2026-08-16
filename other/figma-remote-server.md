> [!-secondary] -secondary
> note
> 
> **Note:** Only clients listed in the [Figma MCP Catalog](https://www.figma.com/mcp-catalog/) like VS Code, Cursor, or Claude Code can connect to the Figma MCP Server. If you're a developer interested in connecting a new MCP client, you can [join the waitlist](https://form.asana.com/?k=kBG-ejRQTdY8x_H6a4vM3Q&d=10497086658021).

The Figma MCP server brings Figma directly into your workflow by providing important design information and context to AI agents generating code from Figma design files.

MCP servers are part of a standardized interface for AI agents to interact with data sources using the [Model Context Protocol](https://modelcontextprotocol.io/).

Figma's remote MCP server makes it possible to connect directly to your Figma files without needing to install Figma's desktop app. You can capture live UI to Figma Design and bring design context into your workflow wherever you're working.

With the server enabled, you can:

- **Write to canvas**: Use a supported MCP client to create and modify native Figma content directly in Figma Design files. Agents can build and update frames, components, variables, and auto layout using your existing design system and file structure as context.
	> [!-secondary] -secondary
	> note
	> 
	> **Note:** We're quickly improving how Figma supports AI agents. This will eventually be a usage-based paid feature, but is currently available for free during the beta period.
- **Generate designs from live UI**: Use a supported MCP client to capture the live UI of your web app or site and send it to new and existing Figma files or your clipboard. ([select clients only](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/))
- **Generate code from selected frames**: Select a Figma frame and turn it into code. Great for product teams building new flows or iterating on app features.
- **Extract design context**: Pull in variables, components, and layout data directly into your IDE. This is especially useful for design systems and component-based workflows.
- **Retrieve Make resources**: [Gather code resources from Make files](https://developers.figma.com/docs/figma-mcp-server/bringing-make-context-to-your-agent/) and provide them to the LLM as context. This can help as you move from prototype to production application.
- **Keep your design system components consistent with Code Connect**: Boost output quality by reusing your actual components. Code Connect keeps your generated code consistent with your codebase.

To use this server, you'll need to sign in through Figma's OAuth authentication flow. Once set up, the remote server gives you a seamless way to access Figma data and integrate it with your tools.

## Enabling the remote MCP server

> [!-secondary] -secondary
> note
> 
> This documentation covers the installation steps for several of our supported MCP clients. For a list of install guides for supported MCP clients, see the [Guide to the Figma MCP server](https://help.figma.com/hc/en-us/articles/32132100833559#h_01K25F7RBRZKCATVJHNXCS6KXW).

Follow the steps for your MCP client:

- [Claude Code](#claude-code)
- [Codex by OpenAI](#codex)
- [Cursor](#cursor)
- [VS Code](#vs-code)

### Claude Code

#### Using the Figma plugin for Claude Code (preferred):

The recommended way to set up the Figma MCP server in Claude Code is by installing the Figma plugin, which includes MCP server settings as well as Agent Skills for common workflows.

Run the following command to install the plugin from Anthropic's official plugin marketplace.

```bash
claude plugin install figma@claude-plugins-official
```

Learn more about Anthropic's [Claude Code plugins](https://claude.com/blog/claude-code-plugins) and [Agent Skills](https://claude.com/blog/skills).

#### Manual setup for Claude Code

1. Run the following command in your terminal to add the Figma MCP to Claude Code: `claude mcp add --transport http figma https://mcp.figma.com/mcp`
	> [!-success] -success
	> tip
	> 
	> **Tip:** To make your Figma MCP server available across all projects, install it with the `--scope user` flag: `claude mcp add --scope user --transport http figma https://mcp.figma.com/mcp`
	> 
	> By default, Claude Code uses local scope, so the server is only available in the current project. Applying the user scope means you don't have to reinstall the server for each of your projects.
2. Start a new instance of Claude Code.
3. Type `/mcp` in Claude to manage your MCP Servers and select **figma**. ![Claude remote MCP manage](https://developers.figma.com/assets/images/claude-remote-mcp-manage-9159bd35956998870502ea6e580190ff.png)
4. Select **Authenticate**. ![Select authenticate in Claude](https://developers.figma.com/assets/images/claude-remote-mcp-select-authenticate-683c3f070213a992c78012127c4dec96.png)
5. Click **Allow Access**. ![Claude remote MCP login](https://developers.figma.com/assets/images/claude-remote-mcp-login-78b7506e239e20e9160e8cc35df53a13.png)
6. Back in Claude code, you should see: `Authentication successful. Connected to figma`
7. Confirm your MCP Server is connected using `/mcp` command in Claude Code. ![Claude remote MCP confirm](https://developers.figma.com/assets/images/claude-remote-mcp-confirm-79e4962fbbc8212cb08cd32323fcf0e7.png)
8. Start prompting!

### Codex

#### Using the Codex app (preferred):

1. [Install the Codex app.](https://developers.openai.com/codex/app/)
2. In the upper-left corner of the Codex app, click **Plugins**.
3. Click **+** next to Figma.
	![Install the Figma plugin for Codex](https://developers.figma.com/assets/images/codex-install-figma-plugin-1602628356383581bc7bddfa7741a9aa.png)
4. Click **Install Figma** to begin the installation process.
5. Go through the authentication process. Click **Allow access** to authenticate and allow ChatGPT to access your Figma account.
6. Start prompting Codex to [use the tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) provided by the Figma MCP server.

#### Manual setup for Codex:

1. [Install the Codex CLI.](https://developers.openai.com/codex/cli/)
2. In your terminal, run the following command: `codex mcp add figma --url https://mcp.figma.com/mcp`
	When prompted, authenticate the server.
3. Start prompting Codex to [use the tools](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/) provided by the Figma MCP server.

### Cursor

#### Using the Figma plugin for Cursor (preferred):

The recommended way to set up the Figma MCP server in Cursor is by installing the Figma plugin, which includes MCP server settings as well as Agent Skills for common workflows.

Install the plugin by typing the following command in Cursor's agent chat:

```markdown
/add-plugin figma
```

The plugin includes:

- MCP server configuration for the Figma MCP server
- Skills for implementing designs, connecting components via Code Connect, and creating design system rules
- Rules for proper asset handling from the Figma MCP server

#### Manual setup for Cursor:

1. Click the [Figma MCP server deep link](cursor://anysphere.cursor-deeplink/mcp/install?name=Figma&config=eyJ1cmwiOiJodHRwczovL21jcC5maWdtYS5jb20vbWNwIn0%3D). This will open the MCP configuration in Cursor.
2. Click **Install** under 'Install MCP Server?' ![Cursor MCP configuration](https://developers.figma.com/assets/images/cursor-mcp-config-b4ae0da52e3434f342093ad56192b7e7.png)
3. Click **Connect** next to Figma to begin the authentication process.
4. Click **Open**. ![Cursor MCP open dialog](https://developers.figma.com/assets/images/cursor-mcp-open-43cde8cf5984e7d563c69c383fa525e7.png)
5. **Allow access** ![Cursor allow access dialog](https://developers.figma.com/assets/images/cursor-allow-access-f6386dba3a7e7a2ef1508d9948f624e3.png)
6. Start prompting!

### VS Code

1. Use the shortcut ⌘ Shift P, and then:
	- Select **MCP: Open User Configuration** to use the Figma MCP server globally.
		- Select **MCP: Open Workspace Folder MCP Configuration** to use the Figma MCP server just inside your current workspace.
	> [!-secondary] -secondary
	> note
	> 
	> **Note:** If it doesn't exist already, you're prompted to create an `mcp.json` file.
2. In the `mcp.json` file, paste the following code:
	```markdown
	{
	   "inputs": [],
	   "servers": {
	     "figma": {
	       "url": "https://mcp.figma.com/mcp",
	       "type": "http"
	     }
	   }
	 }
	```
3. Click on Start (above the MCP server name). ![VS Code MCP start](https://developers.figma.com/assets/images/vscode-remote-mcp-json-8ec911dc2049f86332e9e9fc4c28270e.png)
4. **Allow Access**.
	![VS Code MCP allow access](https://developers.figma.com/assets/images/vscode-remote-mcp-allow-access-dcb8e8a66c134c66452d047e6f6d95fe.png)
5. Start prompting!

## Using the MCP server

The MCP server introduces a set of tools that help LLMs bring your live UI to Figma Design and get design context from Figma. Once connected, you can start prompting your MCP client.

For a complete list of tools and examples, see [Tools and Prompts](https://developers.figma.com/docs/figma-mcp-server/tools-and-prompts/).

### Example: Send UI to Figma

> [!-secondary] -secondary
> note
> 
> **Note:** Currently for use with select MCP clients. See [Code to canvas](https://developers.figma.com/docs/figma-mcp-server/code-to-canvas/).

Sending the live UI of your web app or site to Figma is done through conversation with your MCP client:

1. Prompt your MCP client: "Start a local server for my app and capture the UI in a new Figma file.”
2. Follow the steps your client provides. Your client will open a browser window for you, or give you a link to follow.
3. Use the capture toolbar to capture pages, elements, and states of your web app or site.
4. Let your client know when you're finished. Your client will give you a link to open the Figma file that was created.

### Example: Get design context

Getting design context and code from files is link-based. To use it:

1. Copy the link to a frame or layer in Figma
2. Prompt your client to help you implement the design at the selected URL
	![MCP client with link-based prompt](https://developers.figma.com/assets/images/mcp-client-link-prompt-9d423d7411aa6f368abb1e71ad9fd93c.png)

> [!-secondary] -secondary
> note
> 
> **Note:** Your client won't be able to navigate to the selected URL, but it will extract the node-id that is required for the MCP server to identify which object to return information about.

## Improving the MCP server output

For the best output, we recommend setting up rules to guide the agent. To get you started, we have some [helpful example rules](https://developers.figma.com/docs/figma-mcp-server/add-custom-rules/#rules-to-ensure-consistently-good-output).