#!/usr/bin/env python3
"""Export an official TrackNetV4 Keras checkpoint to the browser contract.

The official repository does not check weights into Git. Its RESULT.md currently
contains placeholder (#) download links, so this path is reproducible only when
a reviewer supplies a local .keras/.h5 checkpoint or trains one first.
"""
import argparse
import hashlib
import importlib.util
import json
import pathlib
import sys


def source_module(source):
    path = pathlib.Path(source) / 'src' / 'models' / 'TrackNetV4.py'
    spec = importlib.util.spec_from_file_location('tracknet_v4_source_model', path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def sha256(path):
    digest = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True, help='local AR4152/TrackNetV4 checkout')
    parser.add_argument('--weights', required=True, help='local .keras or .h5 checkpoint')
    parser.add_argument('--output', required=True, help='output .onnx path')
    parser.add_argument('--fusion', choices=('TypeA', 'TypeB'), default='TypeA')
    args = parser.parse_args()

    import tensorflow as tf
    import tf2onnx

    source = source_module(args.source)
    custom = {
        'MotionPromptLayer': source.MotionPromptLayer,
        'FusionLayerTypeA': source.FusionLayerTypeA,
        'FusionLayerTypeB': source.FusionLayerTypeB,
    }
    weights = pathlib.Path(args.weights)
    if weights.suffix.lower() == '.keras':
        model = tf.keras.models.load_model(weights, custom_objects=custom, compile=False)
    else:
        model = source.TrackNetV4(288, 512, fusion_layer_type=args.fusion)
        model.load_weights(weights)
    model.trainable = False
    output = pathlib.Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    signature = (tf.TensorSpec((None, 9, 288, 512), tf.float32, name='frames'),)
    tf2onnx.convert.from_keras(model, input_signature=signature, opset=17, output_path=str(output))
    metadata = {
        'source': 'https://github.com/AR4152/TrackNetV4',
        'source_license': 'MIT (repository LICENSE covers source; weight provenance must be recorded separately)',
        'weights': str(weights.resolve()), 'weights_sha256': sha256(weights),
        'input': [1, 9, 288, 512], 'output': [1, 3, 288, 512], 'fusion': args.fusion,
        'opset': 17, 'motion_prompt': True,
        'note': 'Official RESULT.md has placeholder download links; this conversion requires a separately supplied checkpoint.',
    }
    output.with_suffix('.json').write_text(json.dumps(metadata, indent=2) + '\n')
    print(json.dumps(metadata, indent=2))


if __name__ == '__main__':
    main()
