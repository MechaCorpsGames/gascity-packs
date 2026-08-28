# Launch the Gas City workspace

Starts the compatible DSH `web` profile on a loopback-only listener.

Local browsers use the printed URL directly. For remote operation, run this
command on the SSH host and forward its loopback port with `ssh -L` or the
editor's SSH port-forwarding UI. Public/LAN binding remains unsupported because
stock DSH does not provide the TLS/authentication boundary for this gateway.
