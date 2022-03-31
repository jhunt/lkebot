IMAGE ?= filefrog/lkebot

run:
	(source envrc; node index.js)

build:
	docker build --platform linux/amd64 -t $(IMAGE) .

push: build
	docker push $(IMAGE)
