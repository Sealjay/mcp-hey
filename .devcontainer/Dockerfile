# See here for image contents: https://github.com/devcontainers/images/tree/main/src/dotnet

# [Choice] .NET version: 8.0, 7.0, 6.0
ARG VARIANT="8.0"
FROM mcr.microsoft.com/devcontainers/dotnet:${VARIANT}

# [Option] Install Node.js (Bun can coexist with Node)
ARG NODE_VERSION="lts/*"
RUN if [ "${NODE_VERSION}" != "none" ]; then su vscode -c "umask 0002 && . /usr/local/share/nvm/nvm.sh && nvm install ${NODE_VERSION} 2>&1"; fi

# [Option] Install Azure CLI
ARG INSTALL_AZURE_CLI="false"
COPY library-scripts/*.sh library-scripts/*.env /tmp/library-scripts/
RUN if [ "$INSTALL_AZURE_CLI" = "true" ]; then bash /tmp/library-scripts/azcli-debian.sh; fi \
    && apt-get clean -y && rm -rf /var/lib/apt/lists/* /tmp/library-scripts

# Install Python 3.12
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get install -y software-properties-common gcc \
    && add-apt-repository -y ppa:deadsnakes/ppa \
    && apt-get update \
    && apt-get -y install --no-install-recommends python3.12 python3.12-venv python3.12-dev python3-pip \
    && update-alternatives --install /usr/bin/python3 python3 /usr/bin/python3.12 1 \
    && python3 -m pip install --no-cache-dir --upgrade pip

# Install UV for Python package management
RUN curl -LsSf https://astral.sh/uv/install.sh | sh \
    && echo 'export PATH="$HOME/.local/bin:$PATH"' >> /home/vscode/.bashrc

# Install Bun
RUN su vscode -c "curl -fsSL https://bun.sh/install | bash" \
    && echo 'export PATH="$HOME/.bun/bin:$PATH"' >> /home/vscode/.bashrc
