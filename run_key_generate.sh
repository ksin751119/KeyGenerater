#!/bin/bash

# Set necessary environment variables
export KMS_KEY_ARN=
export SECRET_ARN=
export BITWARDEN_COLLECTION_NAME=
export BITWARDEN_ITEM_NAME=
export AWS_REGION=
export BW_SERVER=




if ! bw login --check; then
    echo "Bitwarden not logged in, proceeding with login..."

    # Attempt to log out (if already logged in)
    bw logout || true

    # Set server configuration
    bw config server $BW_SERVER

    # Log in to Bitwarden
    bw login

    echo "Bitwarden login successful."
else
    echo "Bitwarden already logged in."
fi
# Get session key and set as environment variable
export BW_SESSION=$(bw unlock --raw)

# If unlock fails, exit the script
if [ $? -ne 0 ]; then
    echo "Unable to unlock Bitwarden vault. Please check your master password."
    exit 1
fi

echo "Bitwarden vault unlocked. Session set."




# Run keyGenerate.ts
npx ts-node keyGenerate.ts
