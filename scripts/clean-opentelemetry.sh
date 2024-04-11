#!/bin/bash

packages="./node_modules/@opentelemetry/*/package.json"

for file in ${packages}; do
  sed -i '/"module": "build\/esm\/index\.js",/d' ${file}
done
