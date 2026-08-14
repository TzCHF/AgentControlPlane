# AgentControlPlane

[English](../../../README.md) | [简体中文](../zh-CN/README.md) | [繁體中文](../zh-TW/README.md) | [Français](../fr/README.md) | **Español** | [日本語](../ja/README.md)

> Software experimental, local-first, para evaluación por un solo usuario.

AgentControlPlane conecta una IA web compatible con MCP con agentes de ingeniería intercambiables que se ejecutan en el equipo del usuario. La conversación web aclara la intención una sola vez; después, el control plane convierte el resultado en un brief de ingeniería compacto y estructurado, conserva el estado de las tareas, recoge evidencias de ejecución y devuelve el resultado a la IA web sin ciclos manuales de copiar y pegar.

El núcleo local de AgentControlPlane es open source bajo [Apache License 2.0](../../../LICENSE). Un relay alojado, un servicio gestionado, una distribución de marca o funciones empresariales pueden ofrecerse por separado.

## Por qué existe

El traspaso manual entre una IA web y un coding agent repite contexto y puede introducir errores al reinterpretar el requisito. AgentControlPlane mantiene ese bucle en un formato legible por máquina:

```text
IA web -> brief compacto -> AgentControlPlane -> executor local
IA web <- resultado/evidencia/estado <- Task Store <- executor local
```

No convierte cuota de chat en cuota de ingeniería ni evita límites del proveedor. Cada executor utiliza su propia cuenta, suscripción o configuración API.

## Superficies compatibles

La interfaz northbound usa MCP estándar y no depende de un único modelo. Actualmente está documentada la conexión con ChatGPT; cualquier otra IA web compatible con MCP puede utilizar las mismas herramientas.

Executors locales compatibles actualmente:

- OpenCode CLI
- Codex App Server
- Claude Code CLI
- endpoints locales compatibles con OpenAI, incluido OpenCodex
- DeepSeek mediante el adaptador OpenAI-compatible

Claude Code es opcional. Instalar el CLI no es suficiente: el adaptador se habilita después de iniciar sesión con Claude Pro/Max o configurar una API key de Anthropic. En caso contrario, discovery devuelve `not_authenticated` y el routing automático lo omite.

Al iniciar, `executor.provider: "auto"` detecta backends instalados/configurados y selecciona el primero disponible en `executor.routing.order`. Una tarea también puede indicar explícitamente `executor: "opencode"`, `"codex"`, `"claude"`, `"openai-compatible"` o `"deepseek"`.

Los threads persistentes se aíslan por executor, por lo que un mismo workspace puede mantener sesiones independientes de Codex, OpenCode y Claude Code. La IA web también puede transferir un trabajo terminado a otro executor transmitiendo solo evidencia compacta, sin volver a enviar toda la conversación.

## Inicio rápido

Requisitos: Node.js 22 o superior y al menos un executor local compatible.

```powershell
git clone https://github.com/Ya-KARAS/AgentControlPlane.git
cd AgentControlPlane
npm.cmd install
npm.cmd test
npm.cmd run doctor
npm.cmd start
```

El servicio escucha en `http://127.0.0.1:4318`. `npm.cmd run doctor` muestra todos los executors detectados y la ruta automática por defecto.

Para conectar ChatGPT, consulta [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md). Dependiendo de la IA web, puede ser necesaria una configuración inicial de connector, permisos o tunnel.

## Ejemplo de delegación

Pide a la IA web conectada:

```text
Usa el perfil balanced y selección automática de executor. Inspecciona el
proyecto, implementa y prueba GET /hello, verifica el resultado y devuelve los
archivos modificados y la evidencia de tests. Si aparece un bloqueo o una mala
interpretación, corrige el brief y continúa el mismo proyecto. Si conviene una
revisión independiente, transfiere el resultado terminado a otro executor.
```

La IA usa `dispatch_project`, consulta `task_status`, utiliza `continue_project` para correcciones con el mismo executor y `handoff_project` para revisión o continuación con otro executor.

## Perfiles y uso

| Perfil | Uso | Esfuerzo | Subagentes | Presupuesto |
|---|---|---|---:|---:|
| economy | Cambios pequeños y bien definidos | low | 0 | 30k |
| balanced | Funciones y correcciones habituales | high | hasta 2 | 90k |
| deep | Arquitectura, refactors amplios y debugging complejo | ultra | hasta 4 | 220k |

Los perfiles son políticas por defecto. Cada tarea puede sobrescribir modelo, esfuerzo, número de subagentes y presupuesto de tokens. La precisión del uso depende de la telemetría disponible en cada executor.

Consulta [BENCHMARKING.md](../../BENCHMARKING.md) para comparar ejecución controlada frente a ejecución directa.

## Herramientas MCP

- `dispatch_project` — enviar un brief compacto con routing automático o explícito
- `dispatch_opencode` — acceso directo compatible con OpenCode
- `task_status` — leer estado, resultado, evidencias, uso y eventos opcionales
- `continue_project` — corregir o continuar en el mismo thread del executor
- `handoff_project` — transferir evidencia compacta a otro executor
- `cancel_task` — detener una tarea en cola o activa
- `list_tasks` — listar tareas recientes
- `list_executors` — ver discovery, disponibilidad, capacidades y ruta por defecto
- `list_profiles` — listar políticas de ejecución
- `list_models` — listar el catálogo cacheado de modelos de un executor
- `usage_report` — agregar el uso medido de tokens de ingeniería

## Seguridad por defecto

- Los workspaces deben estar dentro de raíces permitidas explícitamente.
- El servicio HTTP rechaza bindings que no sean loopback.
- Codex usa workspace-write con red deshabilitada y verifica el sandbox de Windows antes de ejecutar.
- Otros CLI y adaptadores OpenAI-compatible se ejecutan con los permisos del usuario local; utilízalos solo en workspaces de confianza.
- La autenticación Bearer opcional está disponible mediante `AGENT_CONTROL_TOKEN`.
- El estado y los logs de auditoría append-only permanecen fuera de los workspaces del proyecto.

No expongas el servidor local directamente a Internet. Utiliza un tunnel privado autenticado o un relay alojado y endurecido por separado.

## Documentación

- [ARCHITECTURE.md](../../ARCHITECTURE.md)
- [PROTOCOL.md](../../PROTOCOL.md)
- [CHATGPT-CONNECTION.md](../../CHATGPT-CONNECTION.md)
- [BENCHMARKING.md](../../BENCHMARKING.md)
- [SECURITY-REVIEW.md](../../SECURITY-REVIEW.md)
- [COMMERCIALIZATION.md](../../COMMERCIALIZATION.md)
- [SECURITY.md](../../../SECURITY.md)
- [CHANGELOG.md](../../../CHANGELOG.md)

Por defecto, la allowlist de workspaces es el directorio padre de este repositorio. Usa `AGENT_CONTROL_CONFIG` para configuraciones específicas de cada máquina y no hagas commit de rutas locales ni credenciales.