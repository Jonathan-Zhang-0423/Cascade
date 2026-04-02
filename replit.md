# CodeStart — Mobile-First AI Development Platform

## Overview
CodeStart is a mobile-first development platform designed to enable complete beginners to build production-ready iOS and Android applications using AI coding agents. It supports multiple mobile frameworks (React Native/Expo, Flutter, SwiftUI, Kotlin/Jetpack Compose) and languages (TypeScript, Dart, Swift, Kotlin). Users interact with a "Vibe Coding Agent" through natural language and can preview apps in a device simulator. The platform supports isolated projects, each with its own files, chat history, and preview. The project is pivoting from a web IDE to a mobile-first focus, while maintaining support for existing web projects (HTML/CSS/JS).

## User Preferences
The user wants an AI assistant that:
- Demands clarity from the user.
- Confirms understanding before building.
- Avoids jargon in explanations and code comments.
- Follows an iterative development approach.
- Includes 1-3 emojis in approximately 90% of responses to maintain a warm and friendly tone.
- Provides beginner-friendly, no-jargon inline comments on every line of generated code, matching the user's language.

## System Architecture
The CodeStart IDE utilizes a modern web architecture with distinct frontend and backend components.

**Frontend**:
- Built with React, TypeScript, Tailwind CSS, and Shadcn UI, focusing on a responsive and visually appealing dark-themed interface with rounded elements and clean spacing.
- State management is handled by Zustand, with project data persisted locally.
- The code editor is powered by `@monaco-editor/react`.
- Features a unified theme system with 14 VS Code-style themes managed globally.
- The UI layout includes a tools dock, resizable panels, an editor, a preview pane, and a console.

**Backend**:
- An Express.js server manages API routes for AI interactions and agent communication.

**Core Features & Design Patterns**:
- **Multi-Project System**: Users can manage multiple isolated projects, each with its own state.
- **AI-Driven Development**: The Vibe Coding Agent facilitates app creation through natural language, using a streaming API for real-time code generation and application.
- **Incremental Code Auto-Apply**: AI-generated code blocks are automatically applied to files as they stream, updating the preview instantly.
- **Structured AI Output**: AI responses follow a 3-part format: Thinking, Code, and Changes Summary.
- **Checkpoint/Rollback System**: Automatic checkpoints are created after AI changes, allowing project state restoration using reverse diffs.
- **4-Agent System (Plan Mode)**:
    - **Manager Agent**: Handles conversational planning, brainstorming, and generates structured task plans or fix plans.
    - **Editor Agent**: Executes code tasks as part of the plan.
    - **Verifier Agent**: Conducts holistic project reviews, identifying bugs, missing features, or regressions.
    - **Communicator Agent**: Provides user-facing progress updates and narration in real-time, acting as the sole user interface for agent output.
    - This system orchestrates a Plan → Build → Review → Fix cycle, with user confirmation for subjective issues.
- **Performance Optimizations**: Includes non-blocking communication, optimized `max_tokens` usage for AI models, filtered conversation history, throttled streaming UI updates, and sending only relevant files to the Editor agent.
- **My Coding Notebook / Learner Space**:
    - **Mentor Agent**: Analyzes project files to generate structured learning content (project summary, file breakdowns, mind map, learning tips).
    - Features a toggle between "Workspace" and "Learner Space" with auto-generation of notebooks.
    - Supports two-tier incremental updates: auto-patching for minor changes and user-initiated optimization for deeper refinement.
- **LLM Output Monitor**: A non-modal floating panel displaying real-time, color-coded, source-labeled events from LLM interactions, with pub/sub event bus and batching.
- **Background Build Persistence**: Server-side builds continue independently of client connection, with reconnection support and event buffering.
- **Framework-Aware Preview Adapters**: Provides specialized preview modes for different frameworks (iframe for Web, Expo Snack for React Native, DartPad for Flutter, static code preview with download for SwiftUI/Kotlin). Includes a zip export feature.
- **Live HTML Preview**: Inlines local HTML, CSS, and JS, capturing console output.
- **QR Code Phone Preview**: A local preview server serves project files with live reload via WebSockets, accessible on mobile devices via a QR code. Sessions are token-scoped and auto-expire.
- **Command Palette**: Provides quick access to actions.

## External Dependencies
- **AI Providers**:
    - Doubao (ByteDance/Volcengine) using `doubao-seed-2-0-code-preview-260215` (default) and `doubao-seed-2-0-lite-260215` (Mentor Agent).
    - Kimi K2.5 (Moonshot AI) using `kimi-k2.5` (selectable via toggle).
- **Code Editor**: `@monaco-editor/react`.
- **State Management**: Zustand.
- **UI Components**: Shadcn UI.
- **Icons**: Lucide-react.
- **Resizable Panels**: `react-resizable-panels`.
- **Routing**: wouter.
- **API Client**: `openai` (used with Doubao's API endpoint).