#!/bin/bash
set -e

# Colors for better output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Run unit tests first (these don't need RabbitMQ)
echo -e "${YELLOW}Running unit tests...${NC}"
npm run test:unit

# If unit tests fail, exit early
if [ $? -ne 0 ]; then
  echo -e "${RED}Unit tests failed! Fixing unit tests should be the priority.${NC}"
  exit 1
fi

echo -e "${GREEN}Unit tests passed successfully!${NC}"

# Start RabbitMQ for integration tests
echo -e "${YELLOW}Starting RabbitMQ container for integration tests...${NC}"
docker-compose up -d rabbitmq

# Wait for RabbitMQ to be fully up and running
echo -e "${YELLOW}Waiting for RabbitMQ to be ready...${NC}"
attempt=0
max_attempts=30
until docker-compose exec -T rabbitmq rabbitmqctl status > /dev/null 2>&1 || [ $attempt -eq $max_attempts ]
do
  attempt=$((attempt+1))
  echo "Waiting for RabbitMQ to be ready... (Attempt: $attempt/$max_attempts)"
  sleep 2
done

if [ $attempt -eq $max_attempts ]; then
  echo -e "${RED}RabbitMQ failed to start within the expected time.${NC}"
  docker-compose logs rabbitmq
  docker-compose down
  exit 1
fi

echo -e "${GREEN}RabbitMQ is up and running!${NC}"

# Run integration tests
echo -e "${YELLOW}Running integration tests...${NC}"
npm run test:integration
TEST_EXIT_CODE=$?

# Stop RabbitMQ container
echo -e "${YELLOW}Stopping RabbitMQ container...${NC}"
docker-compose down

# Exit with the test exit code
if [ $TEST_EXIT_CODE -eq 0 ]; then
  echo -e "${GREEN}All tests passed successfully!${NC}"
else
  echo -e "${RED}Integration tests failed!${NC}"
fi

exit $TEST_EXIT_CODE
